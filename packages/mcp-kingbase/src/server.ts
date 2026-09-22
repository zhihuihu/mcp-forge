import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { enforceSqlPolicy, SqlPolicyError } from './sql-policy.js';
import { formatResult } from './format.js';
import { KingbaseClient } from './kingbase-client.js';
import { packageVersion } from './package-metadata.js';
import type { KingbaseConfig } from './types.js';

function errorMessage(error: unknown): string {
  if (error instanceof SqlPolicyError) {
    return error.message;
  }
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? `[${error.code}] ` : '';
    return `${code}${error.message}`;
  }
  return 'Unknown KingbaseES error.';
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

function annotations(config: KingbaseConfig) {
  return config.mode === 'readonly'
    ? { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    : { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
}

function readAnnotations() {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
}

const queryInput = {
  sql: z.string().min(1).describe('One KingbaseES SQL statement. Multiple statements are not allowed.'),
  params: z
    .array(z.unknown())
    .optional()
    .describe('Values for $1, $2, ... placeholders in the SQL statement.'),
};

export function createServer(config: KingbaseConfig, client: KingbaseClient): McpServer {
  const server = new McpServer({ name: 'mcp-kingbase', version: packageVersion });

  server.registerTool(
    'kingbase_query',
    {
      title: 'Execute a KingbaseES statement',
      description:
        'Execute one KingbaseES statement under the configured readonly, write, or admin policy. Supports $1, $2, ... placeholders.',
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
        return failure('KingbaseES query failed', error);
      }
    },
  );

  server.registerTool(
    'kingbase_get_server_info',
    {
      title: 'Get KingbaseES server information',
      description:
        'Return the KingbaseES version, database compatibility mode (oracle, pg, mysql), current user, database, and schema.',
      annotations: readAnnotations(),
    },
    async () => {
      try {
        const result = await client.execute(
          `SELECT version() AS version,
                  current_setting('database_mode', true) AS database_mode,
                  current_user AS current_user,
                  current_database() AS database_name,
                  current_schema() AS default_schema`,
          [],
          'read',
        );
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to get KingbaseES server information', error);
      }
    },
  );

  server.registerTool(
    'kingbase_list_databases',
    {
      title: 'List KingbaseES databases',
      description: 'List non-template databases visible to the current account.',
      annotations: readAnnotations(),
    },
    async () => {
      try {
        const result = await client.execute(
          `SELECT datname AS database_name,
                  pg_size_pretty(pg_database_size(datname)) AS size,
                  datcollate AS collation
           FROM pg_database
           WHERE datistemplate = false
           ORDER BY datname`,
          [],
          'read',
        );
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to list KingbaseES databases', error);
      }
    },
  );

  server.registerTool(
    'kingbase_list_schemas',
    {
      title: 'List KingbaseES schemas',
      description: 'List accessible schemas (namespaces) in the current database.',
      annotations: readAnnotations(),
    },
    async () => {
      try {
        const result = await client.execute(
          `SELECT schema_name
           FROM information_schema.schemata
           WHERE schema_name NOT IN ('pg_toast', 'pg_temp_1', 'pg_toast_temp_1')
           ORDER BY schema_name`,
          [],
          'read',
        );
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to list KingbaseES schemas', error);
      }
    },
  );

  server.registerTool(
    'kingbase_list_tables',
    {
      title: 'List KingbaseES tables',
      description: 'List tables and views in a specified schema (defaults to public).',
      inputSchema: {
        schema: z
          .string()
          .min(1)
          .optional()
          .describe('Schema name; defaults to public.'),
      },
      annotations: readAnnotations(),
    },
    async (input) => {
      try {
        const args = input as { schema?: string };
        const schema = args.schema ?? 'public';
        const result = await client.execute(
          `SELECT table_schema AS schema,
                  table_name AS table_name,
                  table_type AS table_type
           FROM information_schema.tables
           WHERE table_schema = $1
           ORDER BY table_name`,
          [schema],
          'read',
        );
        return success(formatResult(result, 'read', config.maxRows, config.maxResultBytes));
      } catch (error) {
        return failure('Unable to list KingbaseES tables', error);
      }
    },
  );

  server.registerTool(
    'kingbase_describe_table',
    {
      title: 'Describe a KingbaseES table',
      description: 'Return column definitions, primary keys, and index metadata for a table.',
      inputSchema: {
        table: z.string().min(1).describe('Table name.'),
        schema: z
          .string()
          .min(1)
          .optional()
          .describe('Schema name; defaults to public.'),
      },
      annotations: readAnnotations(),
    },
    async (input) => {
      try {
        const args = input as { table: string; schema?: string };
        const schema = args.schema ?? 'public';
        const [columnsResult, foreignKeysResult, indexesResult] = await Promise.all([
          client.execute(
            `SELECT c.ordinal_position AS position,
                    c.column_name,
                    c.data_type,
                    c.is_nullable,
                    c.column_default,
                    EXISTS (
                      SELECT 1
                      FROM information_schema.table_constraints tc
                      JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                        AND tc.table_schema = kcu.table_schema
                        AND tc.table_name = kcu.table_name
                      WHERE tc.constraint_type = 'PRIMARY KEY'
                        AND kcu.table_schema = c.table_schema
                        AND kcu.table_name = c.table_name
                        AND kcu.column_name = c.column_name
                    ) AS is_primary_key
             FROM information_schema.columns c
             WHERE c.table_schema = $1 AND c.table_name = $2
             ORDER BY c.ordinal_position`,
            [schema, args.table],
            'read',
          ),
          client.execute(
            `SELECT c.conname AS constraint_name,
                    a.attname AS column_name,
                    fn.nspname AS foreign_table_schema,
                    fc.relname AS foreign_table_name,
                    f.attname AS foreign_column_name,
                    pg_get_constraintdef(c.oid) AS definition
             FROM pg_constraint c
             JOIN pg_class cl ON cl.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = cl.relnamespace
             CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS u(conkey, confkey)
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.conkey
             JOIN pg_class fc ON fc.oid = c.confrelid
             JOIN pg_namespace fn ON fn.oid = fc.relnamespace
             JOIN pg_attribute f ON f.attrelid = c.confrelid AND f.attnum = u.confkey
             WHERE c.contype = 'f'
               AND n.nspname = $1
               AND cl.relname = $2
             ORDER BY c.conname, a.attnum`,
            [schema, args.table],
            'read',
          ),
          client.execute(
            `SELECT indexname AS index_name,
                    indexdef AS index_definition
             FROM pg_indexes
             WHERE schemaname = $1 AND tablename = $2
             ORDER BY indexname`,
            [schema, args.table],
            'read',
          ),
        ]);

        interface ColumnRow {
          position: number;
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: unknown;
          is_primary_key: boolean;
        }

        const columnRows = columnsResult.rows as unknown as ColumnRow[];
        if (columnRows.length === 0) {
          return failure(
            'Unable to describe KingbaseES table',
            new Error(`Table "${schema}"."${args.table}" was not found or has no columns.`),
          );
        }

        const primaryKeys = columnRows
          .filter((row) => Boolean(row.is_primary_key))
          .map((row) => String(row.column_name));

        const payload = {
          schema,
          table: args.table,
          columns: columnRows,
          primary_keys: primaryKeys,
          foreign_keys: foreignKeysResult.rows,
          indexes: indexesResult.rows,
        };

        const serialized = JSON.stringify(payload, null, 2);
        if (Buffer.byteLength(serialized, 'utf8') <= config.maxResultBytes) {
          return success(serialized);
        }

        return success(
          JSON.stringify(
            {
              ...payload,
              columns: payload.columns.slice(0, config.maxRows),
              truncated: true,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        return failure('Unable to describe KingbaseES table', error);
      }
    },
  );

  return server;
}
