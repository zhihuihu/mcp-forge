import type { ApiCallInput, ApiCallResult, ApiEndpoint } from './types.js';

export class HttpClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpClientError';
  }
}

export function generateCurlCommand(
  method: string,
  url: string,
  headers: Record<string, string>,
  bodyPayload?: string,
): string {
  const parts: string[] = ['curl', '-X', method.toUpperCase(), `'${url}'`];

  for (const [k, v] of Object.entries(headers)) {
    const escapedVal = v.replace(/'/g, `'\\''`);
    parts.push(`-H '${k}: ${escapedVal}'`);
  }

  if (bodyPayload && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
    const escapedBody = bodyPayload.replace(/'/g, `'\\''`);
    parts.push(`-d '${escapedBody}'`);
  }

  return parts.join(' ');
}

export class ApiHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly defaultHeaders: Record<string, string>,
    private readonly timeoutMs: number,
  ) {}

  async execute(endpoint: ApiEndpoint, input: ApiCallInput): Promise<ApiCallResult> {
    // 1. Path parameters substitution
    let path = endpoint.path;
    const pathParams = input.pathParams ?? {};

    const pathMatches = path.match(/\{([a-zA-Z0-9_-]+)\}/g) ?? [];
    for (const match of pathMatches) {
      const paramName = match.slice(1, -1);
      const val = pathParams[paramName];
      if (val === undefined || val === null || String(val).trim() === '') {
        throw new HttpClientError(`Missing required path parameter: "${paramName}" in path "${endpoint.path}".`);
      }
      path = path.replaceAll(match, encodeURIComponent(String(val)));
    }

    // 2. Query string assembly
    const cleanBase = this.baseUrl.replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${cleanBase}${cleanPath}`);

    if (input.queryParams && typeof input.queryParams === 'object') {
      for (const [key, value] of Object.entries(input.queryParams)) {
        if (value === undefined || value === null) {
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== undefined && item !== null) {
              url.searchParams.append(key, String(item));
            }
          }
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }

    // 3. Headers merging
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...(input.headers ?? {}),
    };

    const hasAccept = Object.keys(headers).some((k) => k.toLowerCase() === 'accept');
    if (!hasAccept) {
      headers['Accept'] = 'application/json, text/plain, */*';
    }

    // 4. Request Body handling
    let bodyPayload: BodyInit | undefined;
    if (input.body !== undefined && input.body !== null && endpoint.method !== 'GET' && endpoint.method !== 'HEAD') {
      const contentType = endpoint.requestBody?.contentType?.toLowerCase() ?? 'application/json';

      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = contentType;
      }

      const activeContentType = headers['Content-Type'] ?? headers['content-type'] ?? '';

      if (typeof input.body === 'string') {
        bodyPayload = input.body;
      } else if (activeContentType.includes('application/x-www-form-urlencoded')) {
        const formParams = new URLSearchParams();
        if (typeof input.body === 'object') {
          for (const [k, v] of Object.entries(input.body as Record<string, unknown>)) {
            if (v !== undefined && v !== null) {
              formParams.append(k, String(v));
            }
          }
        }
        bodyPayload = formParams.toString();
      } else {
        // Default to JSON stringify
        bodyPayload = JSON.stringify(input.body);
      }
    }

    // Generate reproducible curl command
    const curlCommand = generateCurlCommand(
      endpoint.method,
      url.href,
      headers,
      typeof bodyPayload === 'string' ? bodyPayload : undefined,
    );

    // 5. Execute fetch with timeout
    const startTime = Date.now();
    try {
      const response = await fetch(url.href, {
        method: endpoint.method,
        headers,
        ...(bodyPayload !== undefined ? { body: bodyPayload } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const durationMs = Date.now() - startTime;

      // Extract response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        responseHeaders[key] = val;
      });

      const respContentType = responseHeaders['content-type']?.toLowerCase() ?? '';
      let data: unknown;

      const rawText = await response.text();
      if (respContentType.includes('application/json') || respContentType.includes('+json')) {
        try {
          data = JSON.parse(rawText);
        } catch {
          data = rawText;
        }
      } else {
        // Try parsing JSON even if content-type is missing or text/plain
        const trimmed = rawText.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            data = JSON.parse(trimmed);
          } catch {
            data = rawText;
          }
        } else {
          data = rawText;
        }
      }

      return {
        status: response.status,
        statusText: response.statusText,
        url: url.href,
        method: endpoint.method,
        curl: curlCommand,
        headers: responseHeaders,
        data,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpClientError(
        `HTTP ${endpoint.method} request to "${url.href}" failed after ${durationMs} ms: ${message}\nGenerated cURL:\n${curlCommand}`,
      );
    }
  }
}
