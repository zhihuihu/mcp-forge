import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { enforceSqlPolicy, SqlPolicyError } from './sql-policy.js';
import { formatResult } from './format.js';
import { MysqlClient } from './mysql-client.js';
import { packageVersion } from './package-metadata.js';
import type { MysqlConfig } from './types.js';

function errorMessage(error: unknown): string {
  if (error instanceof SqlPolicyError) {
    return error.message;
  }
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? `[${error.code}] ` : '';
    return `${code}${error.message}`;
  }
  return 'Unknown MySQL error.';
}

function success(result: string) {
  return { content: [{ type: 'text' as const, text: result }] };
}

function failure(prefix: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `${prefix}: ${errorMessage(error)}` }],
    isError: true,
  };
}

function annotations(config: MysqlConfig) {
  return config.mode === 'readonly'
    ? { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    : { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
}

function readAnnotations() {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
}

const queryInput = {
  sql: z.string().min(1).describe('One MySQL statement. Multiple statements are not allowed.'),
  params: z
    .array(z.unknown())
    .optional()
    .describe('Values for ? placeholders in the SQL statement.'),
};

export function createServer(config: MysqlConfig, client: MysqlClient): McpServer {
  const server = new McpServer({ name: 'mcp-mysql', version: packageVersion });

  server.registerTool(
    'mysql_query',
    {
      title: 'Execute a MySQL statement',
      description:
        'Execute one MySQL statement under the configured readonly, write, or admin policy. Results are capped by row and byte limits.',
      inputSchema: queryInput,
      annotations: annotations(config),
    },
    async (input) => {
      try {
        const args = input as { sql: string; params?: unknown[] };
        const classification = enforceSqlPolicy(args.sql, config.mode);
        const result = await client.execute(
          classification.statement,
          args.params ?? [],
          classification.kind,
        );
        return success(
          formatResult(result, classification.kind, config.maxRows, config.maxResultBytes),
        );
      } catch (error) {
        return failure('MySQL query failed', error);
      }
    },
  );

  server.registerTool(
    'mysql_get_server_info',
    {
      title: 'Get MySQL server information',
      description: 'Return the server version, current account, and selected database.',
      annotations: readAnnotations(),
    },
    async () => {
      try {
        const result = await client.execute(
          'SELECT VERSION() AS version, @@version_comment AS versionComment, CURRENT_USER() AS currentUser, DATABASE() AS databaseName',
          [],
          'read',
        );
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to get MySQL server information', error);
      }
    },
  );

  server.registerTool(
    'mysql_list_databases',
    {
      title: 'List MySQL databases',
      description: 'List databases visible to the configured MySQL account.',
      annotations: readAnnotations(),
    },
    async () => {
      try {
        const result = await client.execute('SHOW DATABASES', [], 'read');
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to list MySQL databases', error);
      }
    },
  );

  server.registerTool(
    'mysql_list_tables',
    {
      title: 'List MySQL tables',
      description: 'List tables and views in a database visible to the configured account.',
      inputSchema: {
        database: z
          .string()
          .min(1)
          .optional()
          .describe('Database name; defaults to MYSQL_DATABASE.'),
      },
      annotations: readAnnotations(),
    },
    async (input) => {
      try {
        const args = input as { database?: string };
        const database = args.database ?? config.database;
        if (!database) {
          throw new Error('A database is required. Pass database or set MYSQL_DATABASE.');
        }
        const result = await client.execute(
          `SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine, TABLE_COMMENT AS tableComment
           FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = ?
           ORDER BY TABLE_NAME`,
          [database],
          'read',
        );
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to list MySQL tables', error);
      }
    },
  );

  server.registerTool(
    'mysql_describe_table',
    {
      title: 'Describe a MySQL table',
      description: 'Return column definitions for a table.',
      inputSchema: {
        database: z.string().min(1).describe('Database name.'),
        table: z.string().min(1).describe('Table name.'),
      },
      annotations: readAnnotations(),
    },
    async (input) => {
      try {
        const args = input as { database: string; table: string };
        const result = await client.execute(
          `SELECT ORDINAL_POSITION AS ordinalPosition,
                  COLUMN_NAME AS columnName,
                  COLUMN_TYPE AS columnType,
                  IS_NULLABLE AS isNullable,
                  COLUMN_DEFAULT AS columnDefault,
                  COLUMN_KEY AS columnKey,
                  EXTRA AS extra,
                  COLUMN_COMMENT AS columnComment
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
           ORDER BY ORDINAL_POSITION`,
          [args.database, args.table],
          'read',
        );
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to describe MySQL table', error);
      }
    },
  );

  return server;
}
