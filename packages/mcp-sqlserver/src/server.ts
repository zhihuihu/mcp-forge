import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { enforceSqlPolicy, SqlPolicyError } from './sql-policy.js';
import { formatResult } from './format.js';
import { SqlserverClient } from './sqlserver-client.js';
import { packageVersion } from './package-metadata.js';
import type { SqlserverConfig } from './types.js';

function errorMessage(error: unknown): string {
  if (error instanceof SqlPolicyError) {
    return error.message;
  }
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? `[${error.code}] ` : '';
    return `${code}${error.message}`;
  }
  return 'Unknown SQL Server error.';
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

function annotations(config: SqlserverConfig) {
  return config.mode === 'readonly'
    ? { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    : { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
}

function readAnnotations() {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
}

const queryInput = {
  sql: z.string().min(1).describe('One SQL Server statement. Multiple statements are not allowed.'),
  params: z
    .array(z.unknown())
    .optional()
    .describe('Values for @p1, @p2, ... parameter placeholders in the SQL statement.'),
};

export function createServer(config: SqlserverConfig, client: SqlserverClient): McpServer {
  const server = new McpServer({ name: 'mcp-sqlserver', version: packageVersion });

  server.registerTool(
    'sqlserver_query',
    {
      title: 'Execute a SQL Server statement',
      description:
        'Execute one SQL Server statement under the configured readonly, write, or admin policy. Supports @p1, @p2, ... parameter placeholders. Results are capped by row and byte limits.',
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
        return failure('SQL Server query failed', error);
      }
    },
  );

  server.registerTool(
    'sqlserver_get_server_info',
    {
      title: 'Get SQL Server information',
      description: 'Return the SQL Server version, current user, and currently connected database.',
      annotations: readAnnotations(),
    },
    async () => {
      try {
        const result = await client.execute(
          'SELECT @@VERSION AS [version], CURRENT_USER AS [current_user], DB_NAME() AS [current_database], @@SERVERNAME AS [server_name]',
          [],
          'read',
        );
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to get SQL Server information', error);
      }
    },
  );

  server.registerTool(
    'sqlserver_list_databases',
    {
      title: 'List SQL Server databases',
      description: 'List accessible databases and their online state from sys.databases.',
      annotations: readAnnotations(),
    },
    async () => {
      try {
        const result = await client.execute(
          `SELECT name AS database_name, state_desc AS state, create_date AS create_date
           FROM sys.databases
           ORDER BY name`,
          [],
          'read',
        );
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to list SQL Server databases', error);
      }
    },
  );

  server.registerTool(
    'sqlserver_list_schemas',
    {
      title: 'List SQL Server schemas',
      description: 'List schemas in the current database from INFORMATION_SCHEMA.SCHEMATA.',
      annotations: readAnnotations(),
    },
    async () => {
      try {
        const result = await client.execute(
          `SELECT SCHEMA_NAME AS schema_name, SCHEMA_OWNER AS schema_owner
           FROM INFORMATION_SCHEMA.SCHEMATA
           ORDER BY SCHEMA_NAME`,
          [],
          'read',
        );
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to list SQL Server schemas', error);
      }
    },
  );

  server.registerTool(
    'sqlserver_list_tables',
    {
      title: 'List SQL Server tables',
      description: 'List tables and views in the current database, optionally filtered by schema.',
      inputSchema: {
        schema: z.string().min(1).optional().describe('Schema name (e.g. dbo).'),
      },
      annotations: readAnnotations(),
    },
    async (input) => {
      try {
        const args = input as { schema?: string };
        const query = args.schema
          ? `SELECT TABLE_CATALOG AS database_name, TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name, TABLE_TYPE AS table_type
             FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA = @p1
             ORDER BY TABLE_SCHEMA, TABLE_NAME`
          : `SELECT TABLE_CATALOG AS database_name, TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name, TABLE_TYPE AS table_type
             FROM INFORMATION_SCHEMA.TABLES
             ORDER BY TABLE_SCHEMA, TABLE_NAME`;

        const params = args.schema ? [args.schema] : [];
        const result = await client.execute(query, params, 'read');
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to list SQL Server tables', error);
      }
    },
  );

  server.registerTool(
    'sqlserver_describe_table',
    {
      title: 'Describe a SQL Server table',
      description: 'Return column definitions, data types, nullability, and defaults for a table.',
      inputSchema: {
        table: z.string().min(1).describe('Table name.'),
        schema: z.string().min(1).optional().describe('Schema name (e.g. dbo). Defaults to any schema if omitted.'),
      },
      annotations: readAnnotations(),
    },
    async (input) => {
      try {
        const args = input as { table: string; schema?: string };
        const query = args.schema
          ? `SELECT TABLE_SCHEMA AS schema_name,
                    TABLE_NAME AS table_name,
                    COLUMN_NAME AS column_name,
                    ORDINAL_POSITION AS ordinal_position,
                    COLUMN_DEFAULT AS column_default,
                    IS_NULLABLE AS is_nullable,
                    DATA_TYPE AS data_type,
                    CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
                    NUMERIC_PRECISION AS numeric_precision,
                    NUMERIC_SCALE AS numeric_scale
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_NAME = @p1 AND TABLE_SCHEMA = @p2
             ORDER BY ORDINAL_POSITION`
          : `SELECT TABLE_SCHEMA AS schema_name,
                    TABLE_NAME AS table_name,
                    COLUMN_NAME AS column_name,
                    ORDINAL_POSITION AS ordinal_position,
                    COLUMN_DEFAULT AS column_default,
                    IS_NULLABLE AS is_nullable,
                    DATA_TYPE AS data_type,
                    CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
                    NUMERIC_PRECISION AS numeric_precision,
                    NUMERIC_SCALE AS numeric_scale
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_NAME = @p1
             ORDER BY TABLE_SCHEMA, ORDINAL_POSITION`;

        const params = args.schema ? [args.table, args.schema] : [args.table];
        const result = await client.execute(query, params, 'read');
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to describe SQL Server table', error);
      }
    },
  );

  return server;
}
