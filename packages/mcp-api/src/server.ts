import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatApiResult } from './format.js';
import { ApiHttpClient, HttpClientError } from './http-client.js';
import { packageVersion } from './package-metadata.js';
import type { ParsedApiSpec } from './spec-parser.js';
import type { ApiCallInput, ApiEndpoint, HttpMethod, ResolvedConfig } from './types.js';

function success(result: string) {
  return { content: [{ type: 'text' as const, text: result }] };
}

function failure(prefix: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `${prefix}: ${message}` }],
    isError: true,
  };
}

function findEndpoint(
  parsedSpec: ParsedApiSpec,
  operationId?: string,
  path?: string,
  method?: string,
): ApiEndpoint | undefined {
  if (operationId) {
    const direct = parsedSpec.endpointsByOperationId.get(operationId.trim());
    if (direct) {
      return direct;
    }
  }

  if (path && method) {
    const key = `${method.toUpperCase()} ${path.trim()}`;
    const direct = parsedSpec.endpointsByPathAndMethod.get(key);
    if (direct) {
      return direct;
    }

    // Try fuzzy match on path (e.g. without leading slash or with trailing slash)
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const normalizedKey = `${method.toUpperCase()} ${normalizedPath}`;
    const directNorm = parsedSpec.endpointsByPathAndMethod.get(normalizedKey);
    if (directNorm) {
      return directNorm;
    }

    if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
      const strippedPath = normalizedPath.replace(/\/+$/, '');
      return parsedSpec.endpointsByPathAndMethod.get(`${method.toUpperCase()} ${strippedPath}`);
    }
  }

  return undefined;
}

export function createServer(
  config: ResolvedConfig,
  parsedSpec: ParsedApiSpec,
  httpClient: ApiHttpClient,
): McpServer {
  const server = new McpServer({ name: 'mcp-api', version: packageVersion });

  // 1. api_get_spec_info
  server.registerTool(
    'api_get_spec_info',
    {
      title: 'Get API Specification Info',
      description:
        'Return API service title, version, description, target base URL, available tags, and total endpoints count.',
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return success(JSON.stringify(parsedSpec.info, null, 2));
      } catch (error) {
        return failure('Unable to get API specification info', error);
      }
    },
  );

  // 2. api_list_endpoints
  server.registerTool(
    'api_list_endpoints',
    {
      title: 'List or Search API Endpoints',
      description:
        'Search and browse available API endpoints by keyword, tag, or HTTP method. Returns compact endpoint summaries.',
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe('Search query matching path, operationId, summary, description, or tags.'),
        tag: z.string().optional().describe('Filter endpoints by tag.'),
        method: z
          .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
          .optional()
          .describe('Filter by HTTP method.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Maximum number of endpoints to return (default: 50, max: 500).'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Number of endpoints to skip for pagination (default: 0).'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const args = input as {
          search?: string;
          tag?: string;
          method?: HttpMethod;
          limit?: number;
          offset?: number;
        };

        const limit = args.limit ?? 50;
        const offset = args.offset ?? 0;
        const searchQuery = args.search?.trim().toLowerCase();
        const tagFilter = args.tag?.trim().toLowerCase();
        const methodFilter = args.method?.toUpperCase();

        let filtered = parsedSpec.endpoints;

        if (tagFilter) {
          filtered = filtered.filter((ep) =>
            ep.tags.some((t) => t.toLowerCase() === tagFilter),
          );
        }

        if (methodFilter) {
          filtered = filtered.filter((ep) => ep.method === methodFilter);
        }

        if (searchQuery) {
          filtered = filtered.filter((ep) => {
            return (
              ep.operationId.toLowerCase().includes(searchQuery) ||
              ep.path.toLowerCase().includes(searchQuery) ||
              Boolean(ep.summary?.toLowerCase().includes(searchQuery)) ||
              Boolean(ep.description?.toLowerCase().includes(searchQuery)) ||
              ep.tags.some((t) => t.toLowerCase().includes(searchQuery))
            );
          });
        }

        const totalMatched = filtered.length;
        const page = filtered.slice(offset, offset + limit);

        const compactList = page.map((ep) => ({
          operationId: ep.operationId,
          method: ep.method,
          path: ep.path,
          summary: ep.summary,
          tags: ep.tags,
          deprecated: ep.deprecated || undefined,
        }));

        const result = {
          totalMatched,
          offset,
          limit,
          returned: compactList.length,
          hasMore: offset + compactList.length < totalMatched,
          endpoints: compactList,
        };

        return success(JSON.stringify(result, null, 2));
      } catch (error) {
        return failure('Unable to list API endpoints', error);
      }
    },
  );

  // 3. api_get_endpoint_details
  server.registerTool(
    'api_get_endpoint_details',
    {
      title: 'Get API Endpoint Details',
      description:
        'Return complete parameter schemas, request body schema, and expected response definitions for a specific endpoint.',
      inputSchema: {
        operationId: z.string().optional().describe('Unique operation ID of the endpoint.'),
        path: z
          .string()
          .optional()
          .describe('Path of the endpoint (e.g. /users/{id}). Required if operationId is omitted.'),
        method: z
          .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
          .optional()
          .describe('HTTP method of the endpoint. Required if path is provided.'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const args = input as {
          operationId?: string;
          path?: string;
          method?: HttpMethod;
        };

        const endpoint = findEndpoint(parsedSpec, args.operationId, args.path, args.method);
        if (!endpoint) {
          const identifier = args.operationId
            ? `operationId "${args.operationId}"`
            : `"${args.method} ${args.path}"`;
          return failure(
            'Endpoint not found',
            new Error(
              `No endpoint matching ${identifier}. Use api_list_endpoints to discover available endpoints.`,
            ),
          );
        }

        const details = {
          operationId: endpoint.operationId,
          method: endpoint.method,
          path: endpoint.path,
          summary: endpoint.summary,
          description: endpoint.description,
          tags: endpoint.tags,
          parameters: endpoint.parameters,
          requestBody: endpoint.requestBody,
          responses: endpoint.responses,
        };

        return success(JSON.stringify(details, null, 2));
      } catch (error) {
        return failure('Unable to get endpoint details', error);
      }
    },
  );

  // 4. api_call
  server.registerTool(
    'api_call',
    {
      title: 'Execute API Request',
      description:
        'Execute a real HTTP request against the configured base URL for a specified OpenAPI endpoint.',
      inputSchema: {
        operationId: z.string().optional().describe('Operation ID of the endpoint to call.'),
        path: z
          .string()
          .optional()
          .describe('Path of the endpoint to call. Required if operationId is omitted.'),
        method: z
          .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
          .optional()
          .describe('HTTP method of the endpoint. Required if path is provided.'),
        pathParams: z
          .record(z.unknown())
          .optional()
          .describe('Key-value pairs for path parameters (e.g. { "id": 123 }).'),
        queryParams: z
          .record(z.unknown())
          .optional()
          .describe('Key-value pairs for query string parameters.'),
        headers: z
          .record(z.string())
          .optional()
          .describe('Additional custom request headers for this call.'),
        body: z.unknown().optional().describe('Request body (JSON object, array, or string).'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      try {
        const args = input as ApiCallInput;

        const endpoint = findEndpoint(parsedSpec, args.operationId, args.path, args.method);
        if (!endpoint) {
          const identifier = args.operationId
            ? `operationId "${args.operationId}"`
            : `"${args.method} ${args.path}"`;
          return failure(
            'Endpoint not found',
            new Error(
              `Cannot execute call: no endpoint matching ${identifier}. Use api_list_endpoints first.`,
            ),
          );
        }

        const result = await httpClient.execute(endpoint, args);
        return success(formatApiResult(result, config.maxResultBytes));
      } catch (error) {
        if (error instanceof HttpClientError) {
          return failure('API call failed', error);
        }
        return failure('Unexpected API call error', error);
      }
    },
  );

  return server;
}
