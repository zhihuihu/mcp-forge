import type {
  ApiEndpoint,
  ApiParameter,
  ApiRequestBody,
  ApiResponseDef,
  ApiSpecInfo,
  HttpMethod,
  ParameterIn,
} from './types.js';

export interface ParseSpecOptions {
  baseUrlOverride?: string;
  includeTags?: string[];
  excludeTags?: string[];
  includeOperations?: string[];
}

export interface ParsedApiSpec {
  info: ApiSpecInfo;
  endpoints: ApiEndpoint[];
  endpointsByOperationId: Map<string, ApiEndpoint>;
  endpointsByPathAndMethod: Map<string, ApiEndpoint>;
}

const HTTP_METHODS: readonly HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

function sanitizeOperationId(method: string, path: string): string {
  const cleanPath = path
    .replace(/[{}]/g, '')
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9_]/g, '_'))
    .map((part, idx) => (idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
  return `${method.toLowerCase()}${cleanPath ? cleanPath.charAt(0).toUpperCase() + cleanPath.slice(1) : 'Root'}`;
}

export function resolveRef<T = unknown>(
  obj: unknown,
  root: Record<string, unknown>,
  seenRefs: Set<string> = new Set(),
): T {
  if (obj === null || typeof obj !== 'object') {
    return obj as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveRef(item, root, seenRefs)) as unknown as T;
  }

  const record = obj as Record<string, unknown>;
  const ref = record['$ref'];

  if (typeof ref === 'string') {
    if (seenRefs.has(ref)) {
      // Circular reference detected, return shallow ref object to avoid infinite loop
      return { $ref: ref, circular: true } as unknown as T;
    }

    if (ref.startsWith('#/')) {
      const parts = ref.slice(2).split('/').map(decodeURIComponent);
      let current: unknown = root;
      for (const part of parts) {
        if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
          current = (current as Record<string, unknown>)[part];
        } else {
          current = undefined;
          break;
        }
      }

      if (current !== undefined) {
        const nextSeen = new Set(seenRefs);
        nextSeen.add(ref);
        const resolved = resolveRef(current, root, nextSeen);
        if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
          // Merge other sibling properties (e.g. description overrides)
          const { $ref: _, ...siblings } = record;
          return {
            ...(resolved as Record<string, unknown>),
            ...siblings,
          } as unknown as T;
        }
        return resolved as T;
      }
    }
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = resolveRef(value, root, seenRefs);
  }
  return result as T;
}

function extractBaseUrl(
  spec: Record<string, unknown>,
  source: string,
  isUrl: boolean,
  override?: string,
): string {
  if (override && override.trim().length > 0) {
    let clean = override.trim().replace(/\/+$/, '');
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = `http://${clean}`;
    }
    return clean;
  }

  // OpenAPI 3.x
  if (Array.isArray(spec.servers) && spec.servers.length > 0) {
    const firstServer = spec.servers[0] as { url?: string } | undefined;
    const serverUrl = firstServer?.url?.trim();
    if (serverUrl) {
      if (serverUrl.startsWith('http://') || serverUrl.startsWith('https://')) {
        return serverUrl.replace(/\/+$/, '');
      }
      if (isUrl) {
        try {
          const resolved = new URL(serverUrl, source);
          return resolved.href.replace(/\/+$/, '');
        } catch {
          // Fall through
        }
      }
      return serverUrl.replace(/\/+$/, '');
    }
  }

  // Swagger 2.0
  const host = typeof spec.host === 'string' ? spec.host.trim() : undefined;
  const basePath = typeof spec.basePath === 'string' ? spec.basePath.trim() : '';
  const schemes = Array.isArray(spec.schemes) ? (spec.schemes as string[]) : [];
  let scheme = schemes[0]?.toLowerCase() ?? 'http';

  if (host) {
    return `${scheme}://${host}${basePath}`.replace(/\/+$/, '');
  }

  if (isUrl) {
    try {
      const parsed = new URL(source);
      return `${parsed.protocol}//${parsed.host}${basePath}`.replace(/\/+$/, '');
    } catch {
      // Fall through
    }
  }

  return 'http://localhost:8080';
}

export function parseApiSpec(
  rawSpec: Record<string, unknown>,
  source: string,
  isUrl: boolean,
  options: ParseSpecOptions = {},
): ParsedApiSpec {
  const root = rawSpec;
  const infoObj = (root.info as Record<string, unknown> | undefined) ?? {};
  const title = typeof infoObj.title === 'string' ? infoObj.title : 'API Service';
  const version = typeof infoObj.version === 'string' ? infoObj.version : '1.0.0';
  const description = typeof infoObj.description === 'string' ? infoObj.description : undefined;

  let specFormat = 'OpenAPI';
  if (typeof root.openapi === 'string') {
    specFormat = `OpenAPI ${root.openapi}`;
  } else if (typeof root.swagger === 'string') {
    specFormat = `Swagger ${root.swagger}`;
  }

  const baseUrl = extractBaseUrl(root, source, isUrl, options.baseUrlOverride);

  const endpoints: ApiEndpoint[] = [];
  const endpointsByOperationId = new Map<string, ApiEndpoint>();
  const endpointsByPathAndMethod = new Map<string, ApiEndpoint>();
  const collectedTags = new Set<string>();

  const rawPaths = (root.paths as Record<string, Record<string, unknown>> | undefined) ?? {};

  for (const [pathKey, pathItem] of Object.entries(rawPaths)) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }

    const pathParameters = Array.isArray(pathItem.parameters)
      ? (pathItem.parameters as unknown[]).map((p) => resolveRef<Record<string, unknown>>(p, root))
      : [];

    for (const methodKey of Object.keys(pathItem)) {
      const upperMethod = methodKey.toUpperCase() as HttpMethod;
      if (!HTTP_METHODS.includes(upperMethod)) {
        continue;
      }

      const operation = pathItem[methodKey] as Record<string, unknown> | undefined;
      if (!operation || typeof operation !== 'object') {
        continue;
      }

      const rawOperationId =
        typeof operation.operationId === 'string' && operation.operationId.trim().length > 0
          ? operation.operationId.trim()
          : sanitizeOperationId(upperMethod, pathKey);

      // Handle duplicate operationIds by suffixing counter
      let operationId = rawOperationId;
      let counter = 1;
      while (endpointsByOperationId.has(operationId)) {
        operationId = `${rawOperationId}_${counter}`;
        counter += 1;
      }

      const summary = typeof operation.summary === 'string' ? operation.summary : undefined;
      const opDescription =
        typeof operation.description === 'string' ? operation.description : undefined;

      const rawTags = Array.isArray(operation.tags)
        ? (operation.tags as unknown[]).filter((t): t is string => typeof t === 'string')
        : [];
      const tags = rawTags.length > 0 ? rawTags : ['default'];
      for (const t of tags) {
        collectedTags.add(t);
      }

      const deprecated = Boolean(operation.deprecated);

      // Filter tags if configured
      if (options.includeTags && options.includeTags.length > 0) {
        const matchesInclude = tags.some((t) => options.includeTags!.includes(t));
        if (!matchesInclude) {
          continue;
        }
      }
      if (options.excludeTags && options.excludeTags.length > 0) {
        const matchesExclude = tags.some((t) => options.excludeTags!.includes(t));
        if (matchesExclude) {
          continue;
        }
      }
      if (options.includeOperations && options.includeOperations.length > 0) {
        if (!options.includeOperations.includes(operationId) && !options.includeOperations.includes(rawOperationId)) {
          continue;
        }
      }

      // Parameters
      const opParameters = Array.isArray(operation.parameters)
        ? (operation.parameters as unknown[]).map((p) => resolveRef<Record<string, unknown>>(p, root))
        : [];

      const allParamsMap = new Map<string, ApiParameter>();
      let swaggerBodyParam: Record<string, unknown> | undefined;

      for (const rawParam of [...pathParameters, ...opParameters]) {
        if (!rawParam || typeof rawParam !== 'object') {
          continue;
        }
        const name = typeof rawParam.name === 'string' ? rawParam.name : '';
        const inType = typeof rawParam.in === 'string' ? (rawParam.in as ParameterIn | 'body') : 'query';

        if (inType === 'body') {
          // Swagger 2.0 body parameter
          swaggerBodyParam = rawParam;
          continue;
        }

        if (!name) {
          continue;
        }

        const resolvedSchema = resolveRef(rawParam.schema ?? rawParam, root);
        const paramKey = `${inType}:${name}`;
        allParamsMap.set(paramKey, {
          name,
          in: inType as ParameterIn,
          required: Boolean(rawParam.required ?? inType === 'path'),
          ...(typeof rawParam.description === 'string' ? { description: rawParam.description } : {}),
          ...(resolvedSchema !== undefined ? { schema: resolvedSchema } : {}),
        });
      }

      // Request Body (OpenAPI 3.x or Swagger 2.0)
      let requestBody: ApiRequestBody | undefined;

      if (operation.requestBody && typeof operation.requestBody === 'object') {
        const resolvedRb = resolveRef<Record<string, unknown>>(operation.requestBody, root);
        const content = (resolvedRb.content as Record<string, Record<string, unknown>> | undefined) ?? {};
        const contentTypes = Object.keys(content);
        const preferredType =
          contentTypes.find((ct) => ct.includes('json')) ??
          contentTypes.find((ct) => ct.includes('form') || ct.includes('multipart')) ??
          contentTypes[0] ??
          'application/json';

        const mediaTypeObj = content[preferredType] ?? {};
        const example = mediaTypeObj.example ?? mediaTypeObj.examples;
        requestBody = {
          required: Boolean(resolvedRb.required),
          ...(typeof resolvedRb.description === 'string' ? { description: resolvedRb.description } : {}),
          contentType: preferredType,
          ...(mediaTypeObj.schema !== undefined ? { schema: resolveRef(mediaTypeObj.schema, root) } : {}),
          ...(example !== undefined ? { example } : {}),
        };
      } else if (swaggerBodyParam) {
        const consumes = Array.isArray(operation.consumes) ? (operation.consumes as string[]) : [];
        const contentType = consumes[0] ?? 'application/json';
        requestBody = {
          required: Boolean(swaggerBodyParam.required),
          ...(typeof swaggerBodyParam.description === 'string'
            ? { description: swaggerBodyParam.description }
            : {}),
          contentType,
          ...(swaggerBodyParam.schema !== undefined
            ? { schema: resolveRef(swaggerBodyParam.schema, root) }
            : {}),
        };
      }

      // Responses
      const responses: Record<string, ApiResponseDef> = {};
      const rawResponses = (operation.responses as Record<string, Record<string, unknown>> | undefined) ?? {};

      for (const [statusCode, rawResp] of Object.entries(rawResponses)) {
        if (!rawResp || typeof rawResp !== 'object') {
          continue;
        }
        const resolvedResp = resolveRef<Record<string, unknown>>(rawResp, root);
        const respContent = (resolvedResp.content as Record<string, Record<string, unknown>> | undefined) ?? {};
        const respTypes = Object.keys(respContent);
        const primaryType = respTypes.find((ct) => ct.includes('json')) ?? respTypes[0];
        const schema = primaryType
          ? resolveRef(respContent[primaryType]?.schema, root)
          : resolveRef(resolvedResp.schema, root);

        responses[statusCode] = {
          statusCode,
          ...(typeof resolvedResp.description === 'string'
            ? { description: resolvedResp.description }
            : {}),
          ...(primaryType ? { contentType: primaryType } : {}),
          ...(schema !== undefined ? { schema } : {}),
        };
      }

      const endpoint: ApiEndpoint = {
        operationId,
        method: upperMethod,
        path: pathKey,
        ...(summary ? { summary } : {}),
        ...(opDescription ? { description: opDescription } : {}),
        tags,
        deprecated,
        parameters: Array.from(allParamsMap.values()),
        ...(requestBody ? { requestBody } : {}),
        responses,
      };

      endpoints.push(endpoint);
      endpointsByOperationId.set(operationId, endpoint);
      endpointsByPathAndMethod.set(`${upperMethod} ${pathKey}`, endpoint);
    }
  }

  const info: ApiSpecInfo = {
    title,
    version,
    ...(description ? { description } : {}),
    baseUrl,
    totalEndpoints: endpoints.length,
    tags: Array.from(collectedTags).sort(),
    specFormat,
  };

  return {
    info,
    endpoints,
    endpointsByOperationId,
    endpointsByPathAndMethod,
  };
}
