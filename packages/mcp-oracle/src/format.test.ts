import { describe, expect, it } from 'vitest';

import { formatResult } from './format.js';
import type { OracleExecutionResult } from './types.js';

describe('formatResult', () => {
  const sampleResult: OracleExecutionResult = {
    rows: [
      { ID: 1, NAME: 'Alice', CREATED_AT: new Date('2026-01-01T00:00:00.000Z') },
      { ID: 2, NAME: 'Bob', CREATED_AT: new Date('2026-01-02T00:00:00.000Z') },
      { ID: 3, NAME: 'Charlie', CREATED_AT: new Date('2026-01-03T00:00:00.000Z') },
    ],
    fields: [
      { name: 'ID', type: 'NUMBER' },
      { name: 'NAME', type: 'VARCHAR2' },
      { name: 'CREATED_AT', type: 'TIMESTAMP' },
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
    expect(parsed.rows[0].CREATED_AT).toBe('2026-01-01T00:00:00.000Z');
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
        ID: i,
        PAYLOAD: 'x'.repeat(200),
      });
    }

    const largeResult: OracleExecutionResult = {
      rows: manyRows,
      fields: [{ name: 'ID' }, { name: 'PAYLOAD' }],
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

  it('handles bigint and buffer values correctly', () => {
    const specialResult: OracleExecutionResult = {
      rows: [{ BIG_ID: BigInt('9007199254740993'), RAW_DATA: Buffer.from('oracle-raw') }],
      fields: [{ name: 'BIG_ID' }, { name: 'RAW_DATA' }],
    };

    const formatted = formatResult(specialResult, 'read', 500, 1024 * 1024);
    const parsed = JSON.parse(formatted);

    expect(parsed.rows[0].BIG_ID).toBe('9007199254740993');
    expect(parsed.rows[0].RAW_DATA).toBe(Buffer.from('oracle-raw').toString('base64'));
  });
});
