import { describe, expect, it } from 'vitest';

import { formatResult } from './format.js';
import type { PostgresExecutionResult } from './types.js';

describe('formatResult', () => {
  const sampleResult: PostgresExecutionResult = {
    rows: [
      { id: 1, name: 'Alice', created_at: new Date('2026-01-01T00:00:00.000Z') },
      { id: 2, name: 'Bob', created_at: new Date('2026-01-02T00:00:00.000Z') },
      { id: 3, name: 'Charlie', created_at: new Date('2026-01-03T00:00:00.000Z') },
    ],
    fields: [
      { name: 'id', dataTypeId: 23 },
      { name: 'name', dataTypeId: 1043 },
      { name: 'created_at', dataTypeId: 1184 },
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

    const largeResult: PostgresExecutionResult = {
      rows: manyRows,
      fields: [{ name: 'id' }, { name: 'payload' }],
    };

    const maxBytes = 4096;
    const start = performance.now();
    const formatted = formatResult(largeResult, 'read', 500, maxBytes);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100);
    expect(Buffer.byteLength(formatted, 'utf8')).toBeLessThanOrEqual(maxBytes);

    const parsed = JSON.parse(formatted);
    expect(parsed.truncated).toBe(true);
    expect(parsed.returnedRows).toBeLessThan(200);
    expect(parsed.returnedRows).toBeGreaterThan(0);
  });

  it('handles bigint, array, and json values correctly', () => {
    const specialResult: PostgresExecutionResult = {
      rows: [
        {
          big_id: BigInt('9007199254740993'),
          tags: ['postgres', 'mcp'],
          meta: { version: 1 },
        },
      ],
      fields: [{ name: 'big_id' }, { name: 'tags' }, { name: 'meta' }],
    };

    const formatted = formatResult(specialResult, 'read', 500, 1024 * 1024);
    const parsed = JSON.parse(formatted);

    expect(parsed.rows[0].big_id).toBe('9007199254740993');
    expect(parsed.rows[0].tags).toEqual(['postgres', 'mcp']);
    expect(parsed.rows[0].meta).toEqual({ version: 1 });
  });
});
