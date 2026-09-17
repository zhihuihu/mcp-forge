import pg from 'pg';
const { Client } = pg;
import type { ClientConfig, QueryResult } from 'pg';

import type { PostgresConfig, PostgresExecutionResult, PostgresField, SqlStatementKind } from './types.js';

function destroyClient(client: pg.Client): void {
  try {
    const stream = (client as unknown as { connection?: { stream?: { destroy: () => void } } })
      ?.connection?.stream;
    if (stream && typeof stream.destroy === 'function') {
      stream.destroy();
    } else {
      client.end().catch(() => undefined);
    }
  } catch {
    // Ignore destruction errors
  }
}

function fieldMetadata(fields: QueryResult['fields']): PostgresField[] {
  if (!fields) {
    return [];
  }
  return fields.map((f) => ({
    name: f.name,
    ...(f.dataTypeID !== undefined ? { dataTypeId: f.dataTypeID } : {}),
    ...(f.tableID !== undefined ? { tableId: f.tableID } : {}),
    ...(f.columnID !== undefined ? { columnId: f.columnID } : {}),
  }));
}

export class PgClient {
  private readonly clientConfig: ClientConfig;

  constructor(private readonly config: PostgresConfig) {
    if (config.connectionString) {
      this.clientConfig = {
        connectionString: config.connectionString,
        connectionTimeoutMillis: config.connectTimeoutMs,
        statement_timeout: config.queryTimeoutMs,
        ssl: config.ssl
          ? {
              rejectUnauthorized: config.sslRejectUnauthorized,
              ...(config.sslCa ? { ca: config.sslCa } : {}),
            }
          : undefined,
      };
    } else {
      this.clientConfig = {
        host: config.host,
        port: config.port,
        user: config.username,
        password: config.password,
        database: config.database,
        connectionTimeoutMillis: config.connectTimeoutMs,
        statement_timeout: config.queryTimeoutMs,
        ssl: config.ssl
          ? {
              rejectUnauthorized: config.sslRejectUnauthorized,
              ...(config.sslCa ? { ca: config.sslCa } : {}),
            }
          : undefined,
      };
    }
  }

  private async connectWithTimeout(client: pg.Client): Promise<void> {
    const timeoutMs = this.config.connectTimeoutMs;
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            destroyClient(client);
            reject(new Error(`PostgreSQL connection timed out after ${timeoutMs} ms during handshake.`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async execute(
    statement: string,
    params: readonly unknown[],
    kind: SqlStatementKind,
  ): Promise<PostgresExecutionResult> {
    const client = new Client(this.clientConfig);
    // Prevent unhandled 'error' events on the EventEmitter from crashing the Node.js process
    client.on('error', () => undefined);

    let transactionStarted = false;
    let hasError = false;

    try {
      await this.connectWithTimeout(client);

      if (kind === 'read') {
        await client.query('BEGIN TRANSACTION READ ONLY');
        transactionStarted = true;
        const res = await client.query({
          text: statement,
          values: params as unknown[],
        });
        await client.query('ROLLBACK');
        transactionStarted = false;
        return {
          rows: res.rows ?? [],
          fields: fieldMetadata(res.fields),
          ...(typeof res.rowCount === 'number' ? { affectedRows: res.rowCount } : {}),
          ...(res.command ? { command: res.command } : {}),
        };
      }

      if (kind === 'dml') {
        await client.query('BEGIN');
        transactionStarted = true;
        const res = await client.query({
          text: statement,
          values: params as unknown[],
        });

        if (
          this.config.mode !== 'admin' &&
          res.rowCount !== null &&
          res.rowCount !== undefined &&
          res.rowCount > this.config.maxAffectedRows
        ) {
          throw new Error(
            `DML affected ${res.rowCount} rows, exceeding PG_MAX_AFFECTED_ROWS=${this.config.maxAffectedRows}.`,
          );
        }

        await client.query('COMMIT');
        transactionStarted = false;
        return {
          rows: res.rows ?? [],
          fields: fieldMetadata(res.fields),
          ...(typeof res.rowCount === 'number' ? { affectedRows: res.rowCount } : {}),
          ...(res.command ? { command: res.command } : {}),
        };
      }

      // DDL and administrative statements executed directly
      const res = await client.query({
        text: statement,
        values: params as unknown[],
      });
      return {
        rows: res.rows ?? [],
        fields: fieldMetadata(res.fields),
        ...(typeof res.rowCount === 'number' ? { affectedRows: res.rowCount } : {}),
        ...(res.command ? { command: res.command } : {}),
      };
    } catch (error) {
      hasError = true;
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      throw error;
    } finally {
      if (hasError) {
        destroyClient(client);
      } else {
        await client.end().catch(() => destroyClient(client));
      }
    }
  }

  async close(): Promise<void> {
    // Short-lived connections; no persistent pool to close.
  }
}
