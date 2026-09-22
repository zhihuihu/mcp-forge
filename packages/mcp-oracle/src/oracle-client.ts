import oracledb from 'oracledb';
import type { OracleConfig, OracleExecutionResult, OracleField, SqlStatementKind } from './types.js';

export class OracleClient {
  private pool: oracledb.Pool | null = null;
  private connectingPromise: Promise<oracledb.Pool> | null = null;

  constructor(private readonly config: OracleConfig) {
    if (this.config.thickMode) {
      if (this.config.oracleHome) {
        oracledb.initOracleClient({ libDir: this.config.oracleHome });
      } else {
        oracledb.initOracleClient();
      }
    }
  }

  async getPool(): Promise<oracledb.Pool> {
    if (this.pool) {
      return this.pool;
    }
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    const poolAttributes: oracledb.PoolAttributes = {
      user: this.config.user,
      password: this.config.password,
      connectString: this.config.connectString,
      poolMin: 0,
      poolMax: 10,
      poolTimeout: 60,
    };

    this.connectingPromise = oracledb
      .createPool(poolAttributes)
      .then((pool) => {
        this.pool = pool;
        this.connectingPromise = null;
        return pool;
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
    kind: SqlStatementKind = 'read',
  ): Promise<OracleExecutionResult> {
    const pool = await this.getPool();
    const connection = await pool.getConnection();

    try {
      const isAutoCommit = this.config.mode !== 'readonly' && kind !== 'read';
      const executeOptions: oracledb.ExecuteOptions = {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: isAutoCommit,
        maxRows: this.config.maxRows,
      };

      const result = await connection.execute<Record<string, unknown>>(
        statement,
        params,
        executeOptions,
      );

      const fields: OracleField[] = [];
      if (result.metaData) {
        for (const meta of result.metaData) {
          fields.push({
            name: meta.name,
            ...(meta.dbTypeName ? { type: meta.dbTypeName } : {}),
          });
        }
      }

      const rows = (result.rows ?? []) as Record<string, unknown>[];
      const affectedRows = typeof result.rowsAffected === 'number' ? result.rowsAffected : undefined;

      return {
        fields,
        rows,
        ...(affectedRows !== undefined ? { affectedRows } : {}),
      };
    } finally {
      await connection.close();
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close(0);
      this.pool = null;
    }
  }
}
