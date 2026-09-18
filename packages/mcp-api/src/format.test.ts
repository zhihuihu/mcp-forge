import { describe, expect, it } from 'vitest';

import { formatApiResult } from './format.js';
import type { ApiCallResult } from './types.js';

describe('formatApiResult', () => {
  it('formats standard responses within byte limits', () => {
    const res: ApiCallResult = {
      status: 200,
      statusText: 'OK',
      method: 'GET',
      url: 'http://example.com/api',
      durationMs: 42,
      headers: { 'content-type': 'application/json' },
      data: { id: 1, name: 'Sample' },
    };

    const formatted = formatApiResult(res, 1024 * 1024);
    const parsed = JSON.parse(formatted);
    expect(parsed.schema_version).toBe(1);
    expect(parsed.status).toBe(200);
    expect(parsed.data).toEqual({ id: 1, name: 'Sample' });
    expect(parsed.truncated).toBe(false);
  });

  it('truncates large array payloads to fit maxResultBytes', () => {
    const largeArray = Array.from({ length: 5000 }, (_, i) => ({
      index: i,
      uuid: `uuid-long-string-identifier-${i}`,
      content: 'Some repeated text payload',
    }));

    const res: ApiCallResult = {
      status: 200,
      statusText: 'OK',
      method: 'GET',
      url: 'http://example.com/items',
      durationMs: 15,
      headers: {},
      data: largeArray,
    };

    const maxBytes = 4096;
    const formatted = formatApiResult(res, maxBytes);
    expect(Buffer.byteLength(formatted, 'utf8')).toBeLessThanOrEqual(maxBytes);

    const parsed = JSON.parse(formatted);
    expect(parsed.truncated).toBe(true);
    expect(parsed.data.length).toBeLessThan(largeArray.length);
    expect(parsed.data.length).toBeGreaterThan(0);
  });
});
