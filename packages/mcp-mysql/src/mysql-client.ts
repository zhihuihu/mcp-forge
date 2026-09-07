import { createPool, type Pool, type PoolConnection } from 'mysql2/promise';
import type { FieldPacket, PoolOptions, ResultSetHeader } from 'mysql2';

import type { MysqlConfig, SqlStatementKind } from './types.js';

export interface MysqlField {
  name: string;
  type?: number;
  database?: string;
  table?: string;
  originalTable?: string;
  originalName?: string;
}

export interface MysqlExecutionResult {
  rows: unknown[];
  fields: MysqlField[];
  affectedRows?: number;
  insertId?: number | string;
  warningStatus?: number;
  changedRows?: number;
}

function isResultSetHeader(value: unknown): value is ResultSetHeader {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'affectedRows' in value &&
    'insertId' in value
  );
}

function fieldMetadata(fields: readonly FieldPacket[]): MysqlField[] {
  return fields.map((field) => ({
    name: field.name,
    ...(field.type !== undefined ? { type: field.type } : {}),
    ...(field.db ? { database: field.db } : {}),
    ...(field.table ? { table: field.table } : {}),
    ...(field.orgTable ? { originalTable: field.orgTable } : {}),
    ...(field.orgName ? { originalName: field.orgName } : {}),
  }));
}

function resultFromQuery(result: unknown, fields: readonly FieldPacket[]): MysqlExecutionResult {
  if (Array.isArray(result)) {
    return {
      rows: result as unknown[],
      fields: fieldMetadata(fields),
    };
  }

  if (isResultSetHeader(result)) {
    return {
      rows: [],
      fields: fieldMetadata(fields),
      affectedRows: Number(result.affectedRows),
      insertId: Number(result.insertId),
      warningStatus: Number(result.warningStatus),
      ...(result.changedRows !== undefined ? { changedRows: Number(result.changedRows) } : {}),
    };
  }

  return { rows: [], fields: fieldMetadata(fields) };
}

export class MysqlClient {
  private readonly pool: Pool;

  constructor(private readonly config: MysqlConfig) {
    const options: PoolOptions = {
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      connectTimeout: config.connectTimeoutMs,
      multipleStatements: false,
      ...(config.database ? { database: config.database } : {}),
      ...(config.ssl
        ? {
            ssl: {
              rejectUnauthorized: true,
              ...(config.sslCa ? { ca: config.sslCa } : {}),
            },
          }
        : {}),
    };

    this.pool = createPool(options);
  }

  private async query(
    connection: PoolConnection,
    statement: string,
    params: readonly unknown[],
  ): Promise<MysqlExecutionResult> {
    const [result, fields] = await connection.query(
      {
        sql: statement,
        timeout: this.config.queryTimeoutMs,
      },
      params as any[],
    );

    return resultFromQuery(result, fields ?? []);
  }

  async execute(
    statement: string,
    params: readonly unknown[],
    kind: SqlStatementKind,
  ): Promise<MysqlExecutionResult> {
    const connection = await this.pool.getConnection();
    let transactionStarted = false;

    try {
      if (kind === 'read') {
        await connection.query('START TRANSACTION READ ONLY');
        transactionStarted = true;
        const result = await this.query(connection, statement, params);
        await connection.rollback();
        transactionStarted = false;
        return result;
      }

      if (kind === 'dml') {
        await connection.beginTransaction();
        transactionStarted = true;
        const result = await this.query(connection, statement, params);
        if (
          this.config.mode !== 'admin' &&
          result.affectedRows !== undefined &&
          result.affectedRows > this.config.maxAffectedRows
        ) {
          throw new Error(
            `DML affected ${result.affectedRows} rows, exceeding MYSQL_MAX_AFFECTED_ROWS=${this.config.maxAffectedRows}.`,
          );
        }
        await connection.commit();
        transactionStarted = false;
        return result;
      }

      // DDL and administrative statements are executed directly. Many MySQL DDL statements
      // implicitly commit, so wrapping them in an application transaction is misleading.
      return await this.query(connection, statement, params);
    } catch (error) {
      if (transactionStarted) {
        await connection.rollback().catch(() => undefined);
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
