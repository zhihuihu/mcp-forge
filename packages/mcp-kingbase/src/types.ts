export type KingbaseMode = 'readonly' | 'write' | 'admin';

export type OutputFormat = 'markdown' | 'json';

export type SqlStatementKind = 'read' | 'dml' | 'ddl' | 'admin' | 'transaction' | 'unknown';

export interface SqlClassification {
  kind: SqlStatementKind;
  statement: string;
  firstKeyword: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface KingbaseField {
  name: string;
  dataTypeId?: number | undefined;
}

export interface KingbaseExecutionResult {
  fields: KingbaseField[];
  rows: Record<string, unknown>[];
  affectedRows?: number | undefined;
  command?: string | undefined;
}

export interface KingbaseConfig {
  mode: KingbaseMode;
  host: string;
  port: number;
  user?: string | undefined;
  password?: string | undefined;
  database?: string | undefined;
  schema?: string | undefined;
  ssl: boolean;
  sslCa?: string | undefined;
  connectTimeoutMs: number;
  queryTimeoutMs: number;
  maxRows: number;
  maxResultBytes: number;
  maxAffectedRows: number;
  connectionString?: string | undefined;
}
