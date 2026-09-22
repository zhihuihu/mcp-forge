import sql from 'mssql';
import type { SqlserverConfig, SqlserverExecutionResult, SqlserverField, SqlStatementKind } from './types.js';

export class SqlserverClient {
  private pool: sql.ConnectionPool | null = null;
  private connectingPromise: Promise<sql.ConnectionPool> | null = null;

  constructor(private readonly config: SqlserverConfig) {}

  async getPool(): Promise<sql.ConnectionPool> {
    if (this.pool && this.pool.connected) {
      return this.pool;
    }
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    const poolConfig: sql.config = {
      server: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      connectionTimeout: this.config.connectTimeoutMs,
      requestTimeout: this.config.queryTimeoutMs,
      options: {
        encrypt: this.config.encrypt,
        trustServerCertificate: this.config.trustServerCertificate,
        ...(this.config.instanceName ? { instanceName: this.config.instanceName } : {}),
        ...(this.config.domain ? { domain: this.config.domain } : {}),
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };

    this.connectingPromise = new sql.ConnectionPool(poolConfig)
      .connect()
      .then((connectedPool) => {
        this.pool = connectedPool;
        this.connectingPromise = null;
        return connectedPool;
      })
      .catch((err) => {
        this.connectingPromise = null;
        throw err;
      });

    return this.connectingPromise;
  }

  async execute(
    statement: string,
    params: unknown[] = [],
    _kind: SqlStatementKind = 'read',
  ): Promise<SqlserverExecutionResult> {
    const pool = await this.getPool();
    const request = pool.request();

    if (params && params.length > 0) {
      params.forEach((value, index) => {
        request.input(`p${index + 1}`, value);
      });
    }

    const result = await request.query(statement);

    const recordset = result.recordset;
    const fields: SqlserverField[] = [];
    if (recordset && recordset.columns) {
      for (const colName of Object.keys(recordset.columns)) {
        const col = recordset.columns[colName];
        const colType =
          typeof col?.type === 'function'
            ? (col.type as { name?: string }).name
            : col?.type
              ? String(col.type)
              : undefined;
        fields.push({
          name: colName,
          type: colType,
        });
      }
    } else if (recordset && recordset.length > 0) {
      for (const key of Object.keys(recordset[0])) {
        fields.push({ name: key });
      }
    }

    const rows = (recordset ?? []) as Record<string, unknown>[];
    const totalAffected = Array.isArray(result.rowsAffected)
      ? result.rowsAffected.reduce((a, b) => a + b, 0)
      : undefined;

    const returnValue = 'returnValue' in result ? (result as { returnValue?: unknown }).returnValue : undefined;

    return {
      fields,
      rows,
      affectedRows: totalAffected,
      returnValue,
    };
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }
}
