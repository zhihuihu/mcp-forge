import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { enforceSqlPolicy, SqlPolicyError } from './sql-policy.js';
import { formatResult } from './format.js';
import { OracleClient } from './oracle-client.js';
import { packageVersion } from './package-metadata.js';
import type { OracleConfig } from './types.js';

function errorMessage(error: unknown): string {
  if (error instanceof SqlPolicyError) {
    return error.message;
  }
  if (error instanceof Error) {
    const code = 'errorNum' in error && typeof error.errorNum === 'number' ? `[ORA-${error.errorNum}] ` : '';
    if (error.message.includes('NJS-138')) {
      return `${code}${error.message} (Note: The target database is Oracle 11g or older. node-oracledb Thin mode supports Oracle 12.1+. To connect to Oracle 11g, please configure --thick with Oracle Instant Client)`;
    }
    return `${code}${error.message}`;
  }
  return 'Unknown Oracle error.';
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

function annotations(config: OracleConfig) {
  return config.mode === 'readonly'
    ? { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    : { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
}

function readAnnotations() {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
}

const queryInput = {
  sql: z.string().min(1).describe('One Oracle SQL statement. Multiple statements are not allowed.'),
  params: z
    .array(z.unknown())
    .optional()
    .describe('Values for :1, :2, ... positional binds in the SQL statement.'),
};

export function createServer(config: OracleConfig, client: OracleClient): McpServer {
  const server = new McpServer({ name: 'mcp-oracle', version: packageVersion });

  server.registerTool(
    'oracle_query',
    {
      title: 'Execute an Oracle SQL statement',
      description:
        'Execute one Oracle SQL statement under the configured readonly, write, or admin policy. Supports :1, :2, ... positional binds. Results are capped by row and byte limits.',
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
        return failure('Oracle query failed', error);
      }
    },
  );

  server.registerTool(
    'oracle_get_server_info',
    {
      title: 'Get Oracle server information',
      description: 'Return the Oracle database version, current user/schema, and database name.',
      annotations: readAnnotations(),
    },
    async () => {
      try {
        const result = await client.execute(
          `SELECT (SELECT BANNER FROM v\$version WHERE ROWNUM = 1) AS version,
                  USER AS current_user,
                  SYS_CONTEXT('USERENV', 'DB_NAME') AS database_name
           FROM dual`,
          [],
          'read',
        );
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to get Oracle server information', error);
      }
    },
  );

  server.registerTool(
    'oracle_list_tables',
    {
      title: 'List Oracle tables',
      description: 'List tables accessible to the current account, filtered by schema or defaulting to the connected user.',
      inputSchema: {
        schema: z.string().min(1).optional().describe('Schema / owner name (case-insensitive). Defaults to current user schema if omitted.'),
      },
      annotations: readAnnotations(),
    },
    async (input) => {
      try {
        const args = input as { schema?: string };
        const schema = args.schema ?? config.schema;
        const query = schema
          ? `SELECT OWNER AS schema_name, TABLE_NAME AS table_name, TABLESPACE_NAME AS tablespace_name, NUM_ROWS AS num_rows
             FROM ALL_TABLES
             WHERE OWNER = UPPER(:1)
             ORDER BY TABLE_NAME`
          : `SELECT OWNER AS schema_name, TABLE_NAME AS table_name, TABLESPACE_NAME AS tablespace_name, NUM_ROWS AS num_rows
             FROM ALL_TABLES
             WHERE OWNER = USER
             ORDER BY TABLE_NAME`;

        const params = schema ? [schema] : [];
        const result = await client.execute(query, params, 'read');
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to list Oracle tables', error);
      }
    },
  );

  server.registerTool(
    'oracle_describe_table',
    {
      title: 'Describe an Oracle table',
      description: 'Return column definitions, data types, precision, nullability, and defaults for an Oracle table.',
      inputSchema: {
        table: z.string().min(1).describe('Table name (case-insensitive).'),
        schema: z.string().min(1).optional().describe('Schema / owner name (case-insensitive). Optional.'),
      },
      annotations: readAnnotations(),
    },
    async (input) => {
      try {
        const args = input as { table: string; schema?: string };
        const schema = args.schema ?? config.schema;
        const query = schema
          ? `SELECT OWNER AS schema_name,
                    TABLE_NAME AS table_name,
                    COLUMN_NAME AS column_name,
                    COLUMN_ID AS column_id,
                    DATA_TYPE AS data_type,
                    DATA_LENGTH AS data_length,
                    DATA_PRECISION AS data_precision,
                    DATA_SCALE AS data_scale,
                    NULLABLE AS is_nullable,
                    DATA_DEFAULT AS column_default
             FROM ALL_TAB_COLUMNS
             WHERE TABLE_NAME = UPPER(:1) AND OWNER = UPPER(:2)
             ORDER BY COLUMN_ID`
          : `SELECT OWNER AS schema_name,
                    TABLE_NAME AS table_name,
                    COLUMN_NAME AS column_name,
                    COLUMN_ID AS column_id,
                    DATA_TYPE AS data_type,
                    DATA_LENGTH AS data_length,
                    DATA_PRECISION AS data_precision,
                    DATA_SCALE AS data_scale,
                    NULLABLE AS is_nullable,
                    DATA_DEFAULT AS column_default
             FROM ALL_TAB_COLUMNS
             WHERE TABLE_NAME = UPPER(:1)
             ORDER BY OWNER, COLUMN_ID`;

        const params = schema ? [args.table, schema] : [args.table];
        const result = await client.execute(query, params, 'read');
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to describe Oracle table', error);
      }
    },
  );

  server.registerTool(
    'oracle_list_views',
    {
      title: 'List Oracle views',
      description: 'List views accessible to the current account, filtered by schema or defaulting to the connected user.',
      inputSchema: {
        schema: z.string().min(1).optional().describe('Schema / owner name (case-insensitive). Defaults to current user schema if omitted.'),
      },
      annotations: readAnnotations(),
    },
    async (input) => {
      try {
        const args = input as { schema?: string };
        const schema = args.schema ?? config.schema;
        const query = schema
          ? `SELECT OWNER AS schema_name, VIEW_NAME AS view_name
             FROM ALL_VIEWS
             WHERE OWNER = UPPER(:1)
             ORDER BY VIEW_NAME`
          : `SELECT OWNER AS schema_name, VIEW_NAME AS view_name
             FROM ALL_VIEWS
             WHERE OWNER = USER
             ORDER BY VIEW_NAME`;

        const params = schema ? [schema] : [];
        const result = await client.execute(query, params, 'read');
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to list Oracle views', error);
      }
    },
  );

  return server;
}
