import { describe, expect, it } from 'vitest';

import { formatResult } from './format.js';
import type { MysqlExecutionResult } from './mysql-client.js';

describe('formatResult', () => {
  const sampleResult: MysqlExecutionResult = {
    rows: [
      { id: 1, name: 'Alice', created_at: new Date('2026-01-01T00:00:00.000Z') },
      { id: 2, name: 'Bob', created_at: new Date('2026-01-02T00:00:00.000Z') },
      { id: 3, name: 'Charlie', created_at: new Date('2026-01-03T00:00:00.000Z') },
    ],
    fields: [
      { name: 'id', type: 3 },
      { name: 'name', type: 253 },
      { name: 'created_at', type: 12 },
    ],
  };

  it('formats normal results without truncation', () => {
    const formatted = formatResult(sampleResult, 'read', 500, 1024 * 1024);
    const parsed = JSON.parse(formatted);

    expect(parsed.schema_version).toBe(1);
    expect(parsed.statementType).toBe('read');
    expect(parsed.rowCount).toBe(3);
    expect(parsed.returnedRows).toBe(3);
    expect(parsed.truncated).toBe(false);
    expect(parsed.rows[0].created_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('truncates rows when exceeding maxRows', () => {
    const formatted = formatResult(sampleResult, 'read', 2, 1024 * 1024);
    const parsed = JSON.parse(formatted);

    expect(parsed.rowCount).toBe(3);
    expect(parsed.returnedRows).toBe(2);
    expect(parsed.truncated).toBe(true);
    expect(parsed.rows).toHaveLength(2);
  });

  it('uses binary search to quickly truncate results exceeding maxResultBytes', () => {
    const manyRows: Record<string, unknown>[] = [];
    for (let i = 0; i < 200; i++) {
      manyRows.push({
        id: i,
        payload: 'x'.repeat(200),
      });
    }

    const largeResult: MysqlExecutionResult = {
      rows: manyRows,
      fields: [{ name: 'id' }, { name: 'payload' }],
    };

    const maxBytes = 4096;
    const start = performance.now();
    const formatted = formatResult(largeResult, 'read', 500, maxBytes);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100); // Should be well below 100ms
    expect(Buffer.byteLength(formatted, 'utf8')).toBeLessThanOrEqual(maxBytes);

    const parsed = JSON.parse(formatted);
    expect(parsed.truncated).toBe(true);
    expect(parsed.returnedRows).toBeLessThan(200);
    expect(parsed.returnedRows).toBeGreaterThan(0);
  });

  it('handles bigint and buffer values correctly', () => {
    const specialResult: MysqlExecutionResult = {
      rows: [{ big_id: BigInt('9007199254740993'), blob_data: Buffer.from('hello') }],
      fields: [{ name: 'big_id' }, { name: 'blob_data' }],
    };

    const formatted = formatResult(specialResult, 'read', 500, 1024 * 1024);
    const parsed = JSON.parse(formatted);

    expect(parsed.rows[0].big_id).toBe('9007199254740993');
    expect(parsed.rows[0].blob_data).toBe(Buffer.from('hello').toString('base64'));
  });
});
