export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConfigurationError';
  }
}

export interface CliOptions {
  help: boolean;
  spec?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  authToken?: string;
  apiKey?: string;
  apiKeyHeader?: string;
  includeTags?: string[];
  excludeTags?: string[];
  includeOperations?: string[];
  timeoutMs?: number;
  maxResultBytes?: number;
}

import type { ResolvedConfig } from './types.js';
export type { ResolvedConfig };

function optionalNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function parseHeadersJson(rawJson: string | undefined, source: string): Record<string, string> {
  if (!rawJson) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Must be a JSON object of key-value pairs.');
    }
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      result[k] = String(v);
    }
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new ApiConfigurationError(`Invalid JSON in ${source}: ${msg}`);
  }
}

function parseHeaderLine(line: string): [string, string] {
  const colonIdx = line.indexOf(':');
  if (colonIdx <= 0) {
    throw new ApiConfigurationError(`Invalid header format "${line}". Expected "Header-Name: Value"`);
  }
  const key = line.slice(0, colonIdx).trim();
  const val = line.slice(colonIdx + 1).trim();
  if (!key) {
    throw new ApiConfigurationError(`Header name cannot be empty in "${line}"`);
  }
  return [key, val];
}

function parseCommaSeparated(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

function parseInteger(name: string, value: string | undefined, fallback: number): number {
  const raw = optionalNonEmpty(value);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new ApiConfigurationError(`${name} must be an integer; received: ${value}`);
  }
  return parsed;
}

function requireRange(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ApiConfigurationError(
      `${name} must be an integer between ${minimum} and ${maximum}; received: ${value}`,
    );
  }
  return value;
}

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new ApiConfigurationError(`${option} requires a value.`);
  }
  return value;
}

export function parseCliOptions(args: readonly string[] = process.argv.slice(2)): CliOptions {
  let help = false;
  let spec: string | undefined;
  let baseUrl: string | undefined;
  const headers: Record<string, string> = {};
  let authToken: string | undefined;
  let apiKey: string | undefined;
  let apiKeyHeader: string | undefined;
  let includeTags: string[] | undefined;
  let excludeTags: string[] | undefined;
  let includeOperations: string[] | undefined;
  let timeoutMs: number | undefined;
  let maxResultBytes: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg.startsWith('--spec=')) {
      spec = arg.slice('--spec='.length);
      continue;
    }
    if (arg === '--spec') {
      spec = optionValue(args, index, '--spec');
      index += 1;
      continue;
    }

    if (arg.startsWith('--base-url=')) {
      baseUrl = arg.slice('--base-url='.length);
      continue;
    }
    if (arg === '--base-url') {
      baseUrl = optionValue(args, index, '--base-url');
      index += 1;
      continue;
    }

    if (arg.startsWith('--headers=')) {
      Object.assign(headers, parseHeadersJson(arg.slice('--headers='.length), '--headers'));
      continue;
    }
    if (arg === '--headers') {
      Object.assign(headers, parseHeadersJson(optionValue(args, index, '--headers'), '--headers'));
      index += 1;
      continue;
    }

    if (arg.startsWith('--header=')) {
      const [k, v] = parseHeaderLine(arg.slice('--header='.length));
      headers[k] = v;
      continue;
    }
    if (arg === '--header') {
      const [k, v] = parseHeaderLine(optionValue(args, index, '--header'));
      headers[k] = v;
      index += 1;
      continue;
    }

    if (arg.startsWith('--auth-token=')) {
      authToken = arg.slice('--auth-token='.length);
      continue;
    }
    if (arg === '--auth-token') {
      authToken = optionValue(args, index, '--auth-token');
      index += 1;
      continue;
    }

    if (arg.startsWith('--api-key=')) {
      apiKey = arg.slice('--api-key='.length);
      continue;
    }
    if (arg === '--api-key') {
      apiKey = optionValue(args, index, '--api-key');
      index += 1;
      continue;
    }

    if (arg.startsWith('--api-key-header=')) {
      apiKeyHeader = arg.slice('--api-key-header='.length);
      continue;
    }
    if (arg === '--api-key-header') {
      apiKeyHeader = optionValue(args, index, '--api-key-header');
      index += 1;
      continue;
    }

    if (arg.startsWith('--include-tags=')) {
      includeTags = parseCommaSeparated(arg.slice('--include-tags='.length));
      continue;
    }
    if (arg === '--include-tags') {
      includeTags = parseCommaSeparated(optionValue(args, index, '--include-tags'));
      index += 1;
      continue;
    }

    if (arg.startsWith('--exclude-tags=')) {
      excludeTags = parseCommaSeparated(arg.slice('--exclude-tags='.length));
      continue;
    }
    if (arg === '--exclude-tags') {
      excludeTags = parseCommaSeparated(optionValue(args, index, '--exclude-tags'));
      index += 1;
      continue;
    }

    if (arg.startsWith('--include-operations=')) {
      includeOperations = parseCommaSeparated(arg.slice('--include-operations='.length));
      continue;
    }
    if (arg === '--include-operations') {
      includeOperations = parseCommaSeparated(optionValue(args, index, '--include-operations'));
      index += 1;
      continue;
    }

    if (arg.startsWith('--timeout-ms=')) {
      timeoutMs = parseInteger('--timeout-ms', arg.slice('--timeout-ms='.length), 30_000);
      continue;
    }
    if (arg === '--timeout-ms') {
      timeoutMs = parseInteger('--timeout-ms', optionValue(args, index, '--timeout-ms'), 30_000);
      index += 1;
      continue;
    }

    if (arg.startsWith('--max-bytes=')) {
      maxResultBytes = parseInteger('--max-bytes', arg.slice('--max-bytes='.length), 1_048_576);
      continue;
    }
    if (arg === '--max-bytes') {
      maxResultBytes = parseInteger('--max-bytes', optionValue(args, index, '--max-bytes'), 1_048_576);
      index += 1;
      continue;
    }

    throw new ApiConfigurationError(`Unknown command-line option: ${arg}`);
  }

  return {
    help,
    ...(spec ? { spec } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(authToken ? { authToken } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(apiKeyHeader ? { apiKeyHeader } : {}),
    ...(includeTags ? { includeTags } : {}),
    ...(excludeTags ? { excludeTags } : {}),
    ...(includeOperations ? { includeOperations } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxResultBytes !== undefined ? { maxResultBytes } : {}),
  };
}

export function loadConfig(args: readonly string[] = process.argv.slice(2)): ResolvedConfig {
  const cli = parseCliOptions(args);

  const spec = optionalNonEmpty(cli.spec ?? process.env.API_SPEC);
  if (!spec) {
    throw new ApiConfigurationError(
      'API_SPEC is required. Provide OpenAPI/Swagger spec URL or local path via --spec or API_SPEC environment variable.',
    );
  }

  const baseUrlOverride = optionalNonEmpty(cli.baseUrl ?? process.env.API_BASE_URL);

  const defaultHeaders: Record<string, string> = {};

  // 1. Env headers JSON
  if (process.env.API_HEADERS) {
    Object.assign(defaultHeaders, parseHeadersJson(process.env.API_HEADERS, 'API_HEADERS'));
  }

  // 2. CLI headers override
  if (cli.headers) {
    Object.assign(defaultHeaders, cli.headers);
  }

  // 3. Auth Token shorthand
  const authToken = optionalNonEmpty(cli.authToken ?? process.env.API_AUTH_TOKEN);
  if (authToken) {
    defaultHeaders['Authorization'] = `Bearer ${authToken}`;
  }

  // 4. API Key shorthand
  const apiKey = optionalNonEmpty(cli.apiKey ?? process.env.API_KEY);
  if (apiKey) {
    const keyHeader = optionalNonEmpty(cli.apiKeyHeader ?? process.env.API_KEY_HEADER) ?? 'X-API-Key';
    defaultHeaders[keyHeader] = apiKey;
  }

  const includeTags = cli.includeTags ?? parseCommaSeparated(process.env.API_INCLUDE_TAGS);
  const excludeTags = cli.excludeTags ?? parseCommaSeparated(process.env.API_EXCLUDE_TAGS);
  const includeOperations = cli.includeOperations ?? parseCommaSeparated(process.env.API_INCLUDE_OPERATIONS);

  const timeoutMs = requireRange(
    'API_TIMEOUT_MS',
    cli.timeoutMs ?? parseInteger('API_TIMEOUT_MS', process.env.API_TIMEOUT_MS, 30_000),
    1_000,
    300_000,
  );

  const maxResultBytes = requireRange(
    'API_MAX_RESULT_BYTES',
    cli.maxResultBytes ?? parseInteger('API_MAX_RESULT_BYTES', process.env.API_MAX_RESULT_BYTES, 1_048_576),
    1_024,
    52_428_800,
  );

  return {
    spec,
    ...(baseUrlOverride ? { baseUrlOverride } : {}),
    defaultHeaders,
    ...(includeTags ? { includeTags } : {}),
    ...(excludeTags ? { excludeTags } : {}),
    ...(includeOperations ? { includeOperations } : {}),
    timeoutMs,
    maxResultBytes,
  };
}

export const helpText = `Usage: mcp-api [options]

An OpenAPI/Swagger-driven Model Context Protocol (MCP) server that provides
progressive gateway exploration and execution for REST APIs.

Options:
  --spec=<path|url>            OpenAPI or Swagger spec URL or local file path (.json, .yaml, .yml) [Required]
  --base-url=<url>             Target API base URL (overrides spec servers/host)
  --headers=<json>             Default headers as a JSON object, e.g. '{"X-Tenant": "123"}'
  --header="Key: Value"        Add an individual default header (can be used multiple times)
  --auth-token=<token>         Shorthand to inject "Authorization: Bearer <token>"
  --api-key=<key>              Shorthand to inject API key
  --api-key-header=<name>      Header name for API key (default: X-API-Key)
  --include-tags=<tags>        Comma-separated list of tags to expose
  --exclude-tags=<tags>        Comma-separated list of tags to hide
  --include-operations=<ids>   Comma-separated list of operationIds to expose
  --timeout-ms=<ms>            HTTP request timeout in milliseconds (default: 30000)
  --max-bytes=<bytes>          Max response body bytes before truncation (default: 1048576)
  -h, --help                   Show this help message

Environment variables:
  API_SPEC                     OpenAPI/Swagger spec URL or local path
  API_BASE_URL                 Target API base URL
  API_HEADERS                  Default headers JSON string
  API_AUTH_TOKEN               Bearer token for Authorization header
  API_KEY                      API key value
  API_KEY_HEADER               Header name for API key
  API_INCLUDE_TAGS             Comma-separated tags to include
  API_EXCLUDE_TAGS             Comma-separated tags to exclude
  API_INCLUDE_OPERATIONS       Comma-separated operationIds to include
  API_TIMEOUT_MS               Timeout in ms
  API_MAX_RESULT_BYTES         Max result bytes
`;
