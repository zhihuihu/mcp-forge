export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type ParameterIn = 'path' | 'query' | 'header' | 'cookie';

export interface ResolvedConfig {
  spec: string;
  baseUrlOverride?: string;
  defaultHeaders: Record<string, string>;
  includeTags?: string[];
  excludeTags?: string[];
  includeOperations?: string[];
  timeoutMs: number;
  maxResultBytes: number;
}

export interface ApiSpecInfo {
  title: string;
  version: string;
  description?: string;
  baseUrl: string;
  totalEndpoints: number;
  tags: string[];
  specFormat: string;
}

export interface ApiParameter {
  name: string;
  in: ParameterIn;
  required: boolean;
  description?: string;
  schema?: unknown;
}

export interface ApiRequestBody {
  required: boolean;
  description?: string;
  contentType: string;
  schema?: unknown;
  example?: unknown;
}

export interface ApiResponseDef {
  statusCode: string;
  description?: string;
  contentType?: string;
  schema?: unknown;
}

export interface ApiEndpoint {
  operationId: string;
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated: boolean;
  parameters: ApiParameter[];
  requestBody?: ApiRequestBody;
  responses: Record<string, ApiResponseDef>;
}

export interface ApiCallInput {
  operationId?: string;
  path?: string;
  method?: string;
  pathParams?: Record<string, unknown>;
  queryParams?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ApiCallResult {
  status: number;
  statusText: string;
  url: string;
  method: string;
  curl?: string;
  headers: Record<string, string>;
  data: unknown;
  durationMs: number;
  truncated?: boolean;
}
