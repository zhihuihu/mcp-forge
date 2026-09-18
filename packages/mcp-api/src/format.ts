import type { ApiCallResult } from './types.js';

interface ResultPayload {
  schema_version: 1;
  status: number;
  statusText: string;
  method: string;
  url: string;
  curl?: string;
  durationMs: number;
  headers: Record<string, string>;
  data: unknown;
  truncated: boolean;
}

function serialize(payload: ResultPayload): string {
  return JSON.stringify(payload, null, 2);
}

export function formatApiResult(result: ApiCallResult, maxResultBytes: number): string {
  const basePayload = {
    schema_version: 1 as const,
    status: result.status,
    statusText: result.statusText,
    method: result.method,
    url: result.url,
    ...(result.curl ? { curl: result.curl } : {}),
    durationMs: result.durationMs,
    headers: result.headers,
    truncated: false,
  };

  const initialPayload: ResultPayload = {
    ...basePayload,
    data: result.data,
  };

  const initialSerialized = serialize(initialPayload);
  if (Buffer.byteLength(initialSerialized, 'utf8') <= maxResultBytes) {
    return initialSerialized;
  }

  // Payload exceeded maxResultBytes, perform graceful truncation
  if (Array.isArray(result.data)) {
    const originalArray = result.data;
    let low = 0;
    let high = originalArray.length - 1;
    let bestSerialized = serialize({
      ...basePayload,
      data: [],
      truncated: true,
    });

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidatePayload: ResultPayload = {
        ...basePayload,
        data: originalArray.slice(0, mid + 1),
        truncated: true,
      };
      const candidateSerialized = serialize(candidatePayload);

      if (Buffer.byteLength(candidateSerialized, 'utf8') <= maxResultBytes) {
        bestSerialized = candidateSerialized;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return bestSerialized;
  }

  // For string or object, truncate text representation
  const rawDataString = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
  let low = 0;
  let high = rawDataString.length - 1;
  let bestString = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidateString = rawDataString.slice(0, mid + 1) + '... [TRUNCATED]';
    const candidatePayload: ResultPayload = {
      ...basePayload,
      data: candidateString,
      truncated: true,
    };
    const candidateSerialized = serialize(candidatePayload);

    if (Buffer.byteLength(candidateSerialized, 'utf8') <= maxResultBytes) {
      bestString = candidateSerialized;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return bestString || serialize({
    ...basePayload,
    data: '... [TRUNCATED]',
    truncated: true,
  });
}
