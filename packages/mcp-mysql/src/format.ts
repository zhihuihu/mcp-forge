import type { MysqlExecutionResult } from './mysql-client.js';
import type { JsonValue, SqlStatementKind } from './types.js';

interface ResultPayload {
  schema_version: 1;
  statementType: SqlStatementKind;
  columns: MysqlExecutionResult['fields'];
  rows: JsonValue[];
  rowCount: number;
  returnedRows: number;
  truncated: boolean;
  affectedRows?: number;
  insertId?: JsonValue;
  warningStatus?: number;
  changedRows?: number;
}

function normalizeValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('base64');
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]),
    );
  }
  return String(value);
}

function serialize(payload: ResultPayload): string {
  return JSON.stringify(payload, null, 2);
}

export function formatResult(
  result: MysqlExecutionResult,
  statementType: SqlStatementKind,
  maxRows: number,
  maxResultBytes: number,
): string {
  const totalRowCount = result.rows.length;
  const rowsToFormat = result.rows.slice(0, maxRows);
  let rows = rowsToFormat.map((row) => normalizeValue(row));
  let truncated = rows.length < totalRowCount;

  const basePayload = {
    schema_version: 1 as const,
    statementType,
    columns: result.fields,
    rowCount: totalRowCount,
    ...(result.affectedRows !== undefined ? { affectedRows: result.affectedRows } : {}),
    ...(result.insertId !== undefined ? { insertId: normalizeValue(result.insertId) } : {}),
    ...(result.warningStatus !== undefined ? { warningStatus: result.warningStatus } : {}),
    ...(result.changedRows !== undefined ? { changedRows: result.changedRows } : {}),
  };

  let payload: ResultPayload = {
    ...basePayload,
    rows,
    returnedRows: rows.length,
    truncated,
  };
  let serialized = serialize(payload);
  if (Buffer.byteLength(serialized, 'utf8') <= maxResultBytes) {
    return serialized;
  }

  // If payload exceeds maxResultBytes, perform binary search to find the maximum number of rows that fit
  truncated = true;
  let low = 0;
  let high = rows.length - 1;

  // Base fallback with 0 rows
  const emptyPayload: ResultPayload = {
    ...basePayload,
    rows: [],
    returnedRows: 0,
    truncated: true,
  };
  let bestSerialized = serialize(emptyPayload);

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidateRows = rows.slice(0, mid + 1);
    const candidatePayload: ResultPayload = {
      ...basePayload,
      rows: candidateRows,
      returnedRows: candidateRows.length,
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
