export type SqlserverMode = 'readonly' | 'write' | 'admin';

export type OutputFormat = 'markdown' | 'json';

export type SqlStatementKind = 'read' | 'dml' | 'ddl' | 'admin' | 'transaction' | 'unknown';

export interface SqlClassification {
  kind: SqlStatementKind;
  statement: string;
  firstKeyword: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface SqlserverField {
  name: string;
  type?: string | undefined;
}

export interface SqlserverExecutionResult {
  fields: SqlserverField[];
  rows: Record<string, unknown>[];
  affectedRows?: number | undefined;
  returnValue?: unknown | undefined;
}

export interface SqlserverConfig {
  mode: SqlserverMode;
  host: string;
  port: number;
  user?: string | undefined;
  password?: string | undefined;
  database?: string | undefined;
  instanceName?: string | undefined;
  domain?: string | undefined;
  encrypt: boolean;
  trustServerCertificate: boolean;
  connectTimeoutMs: number;
  queryTimeoutMs: number;
  maxRows: number;
  maxResultBytes: number;
  maxAffectedRows: number;
  connectionString?: string | undefined;
}
