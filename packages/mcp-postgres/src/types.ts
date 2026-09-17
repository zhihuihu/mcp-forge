export type PostgresMode = 'readonly' | 'write' | 'admin';

export type SqlStatementKind = 'read' | 'dml' | 'ddl' | 'admin' | 'transaction' | 'unknown';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface PostgresConfig {
  mode: PostgresMode;
  connectionString?: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  database: string;
  ssl: boolean;
  sslRejectUnauthorized: boolean;
  sslCa?: string;
  maxRows: number;
  maxResultBytes: number;
  queryTimeoutMs: number;
  connectTimeoutMs: number;
  maxAffectedRows: number;
}

export interface SqlClassification {
  kind: SqlStatementKind;
  statement: string;
  firstKeyword: string;
}

export interface PostgresField {
  name: string;
  dataTypeId?: number;
  tableId?: number;
  columnId?: number;
}

export interface PostgresExecutionResult {
  rows: unknown[];
  fields: PostgresField[];
  affectedRows?: number;
  command?: string;
}
