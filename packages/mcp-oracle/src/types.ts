export type OracleMode = 'readonly' | 'write' | 'admin';

export type OutputFormat = 'markdown' | 'json';

export type SqlStatementKind = 'read' | 'dml' | 'ddl' | 'admin' | 'transaction' | 'unknown';

export interface SqlClassification {
  kind: SqlStatementKind;
  statement: string;
  firstKeyword: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface OracleField {
  name: string;
  type?: string | undefined;
}

export interface OracleExecutionResult {
  fields: OracleField[];
  rows: Record<string, unknown>[];
  affectedRows?: number | undefined;
}

export interface OracleConfig {
  mode: OracleMode;
  user?: string | undefined;
  password?: string | undefined;
  connectString: string;
  host?: string | undefined;
  port: number;
  serviceName?: string | undefined;
  sid?: string | undefined;
  schema?: string | undefined;
  thickMode?: boolean | undefined;
  oracleHome?: string | undefined;
  connectTimeoutMs: number;
  queryTimeoutMs: number;
  maxRows: number;
  maxResultBytes: number;
  maxAffectedRows: number;
}
