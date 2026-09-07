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
  const allRows = result.rows.map((row) => normalizeValue(row));
  let rows = allRows.slice(0, maxRows);
  let truncated = rows.length < allRows.length;

  const basePayload = {
    schema_version: 1 as const,
    statementType,
    columns: result.fields,
    rowCount: allRows.length,
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

  while (Buffer.byteLength(serialized, 'utf8') > maxResultBytes && rows.length > 0) {
    rows = rows.slice(0, -1);
    truncated = true;
    payload = {
      ...basePayload,
      rows,
      returnedRows: rows.length,
      truncated,
    };
    serialized = serialize(payload);
  }

  return serialized;
}
