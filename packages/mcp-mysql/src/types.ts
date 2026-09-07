export type MysqlMode = 'readonly' | 'write' | 'admin';

export type SqlStatementKind = 'read' | 'dml' | 'ddl' | 'admin' | 'transaction' | 'unknown';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface MysqlConfig {
  mode: MysqlMode;
  host: string;
  port: number;
  username: string;
  password: string;
  database?: string;
  ssl: boolean;
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
