import { readFileSync } from 'node:fs';

import type { PostgresConfig, PostgresMode } from './types.js';

export class PostgresConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostgresConfigurationError';
  }
}

export interface CliOptions {
  help: boolean;
  mode?: PostgresMode;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseMode(value: string | undefined, source: string): PostgresMode | undefined {
  const normalized = nonEmpty(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'readonly' || normalized === 'write' || normalized === 'admin') {
    return normalized;
  }
  throw new PostgresConfigurationError(
    `${source} must be one of readonly, write, or admin; received: ${value}`,
  );
}

function parseInteger(name: string, value: string | undefined, fallback: number): number {
  const raw = nonEmpty(value);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new PostgresConfigurationError(`${name} must be an integer; received: ${value}`);
  }
  return parsed;
}

function requireRange(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new PostgresConfigurationError(
      `${name} must be an integer between ${minimum} and ${maximum}; received: ${value}`,
    );
  }
  return value;
}

function parseBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  const raw = nonEmpty(value)?.toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (raw === 'true' || raw === '1' || raw === 'yes') {
    return true;
  }
  if (raw === 'false' || raw === '0' || raw === 'no') {
    return false;
  }
  throw new PostgresConfigurationError(`${name} must be true or false; received: ${value}`);
}

function readPassword(): string | undefined {
  const directPassword = process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD;
  if (directPassword !== undefined) {
    return directPassword;
  }

  const passwordFile = nonEmpty(process.env.PGPASSWORD_FILE ?? process.env.POSTGRES_PASSWORD_FILE);
  if (!passwordFile) {
    return undefined;
  }

  try {
    return readFileSync(passwordFile, 'utf8').trimEnd();
  } catch {
    throw new PostgresConfigurationError(
      `Unable to read the password configured by PGPASSWORD_FILE: ${passwordFile}`,
    );
  }
}

function readSslCa(): string | undefined {
  const sslCaPath = nonEmpty(process.env.PGSSL_CA ?? process.env.POSTGRES_SSL_CA);
  if (!sslCaPath) {
    return undefined;
  }

  try {
    return readFileSync(sslCaPath, 'utf8');
  } catch {
    throw new PostgresConfigurationError(`Unable to read SSL CA file: ${sslCaPath}`);
  }
}

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new PostgresConfigurationError(`${option} requires a value.`);
  }
  return value;
}

export function parseCliOptions(args: readonly string[] = process.argv.slice(2)): CliOptions {
  let help = false;
  let mode: PostgresMode | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }

    if (argument.startsWith('--mode=')) {
      mode = parseMode(argument.slice('--mode='.length), '--mode');
      continue;
    }

    if (argument === '--mode') {
      mode = parseMode(optionValue(args, index, '--mode'), '--mode');
      index += 1;
      continue;
    }

    throw new PostgresConfigurationError(`Unknown command-line option: ${argument}`);
  }

  return { help, ...(mode ? { mode } : {}) };
}

export function loadConfig(args: readonly string[] = process.argv.slice(2)): PostgresConfig {
  const cli = parseCliOptions(args);
  const mode =
    cli.mode ??
    parseMode(process.env.PG_MODE ?? process.env.POSTGRES_MODE, 'PG_MODE') ??
    'readonly';

  const connectionString = nonEmpty(process.env.DATABASE_URL ?? process.env.PG_CONNECTION_STRING);

  const host =
    nonEmpty(process.env.PGHOST ?? process.env.POSTGRES_HOST) ??
    (connectionString ? '' : '127.0.0.1');

  const port = requireRange(
    'PGPORT',
    parseInteger('PGPORT', process.env.PGPORT ?? process.env.POSTGRES_PORT, 5432),
    1,
    65_535,
  );

  const username =
    nonEmpty(process.env.PGUSER ?? process.env.POSTGRES_USER) ??
    (connectionString ? '' : 'postgres');

  const database =
    nonEmpty(process.env.PGDATABASE ?? process.env.POSTGRES_DB) ??
    (connectionString ? '' : 'postgres');

  const sslMode = nonEmpty(process.env.PGSSLMODE)?.toLowerCase();
  const rawSsl = process.env.PGSSL ?? process.env.POSTGRES_SSL;
  const connectionStringHasSsl =
    Boolean(connectionString) &&
    (connectionString!.includes('sslmode=') ||
      connectionString!.includes('ssl=true') ||
      connectionString!.includes('supabase.co') ||
      connectionString!.includes('neon.tech') ||
      connectionString!.includes('render.com') ||
      connectionString!.includes('railway.app') ||
      connectionString!.includes('aivencloud.com'));

  const ssl =
    sslMode === 'require' ||
    sslMode === 'verify-ca' ||
    sslMode === 'verify-full' ||
    parseBoolean('PGSSL', rawSsl, connectionStringHasSsl);

  const sslRejectUnauthorized = parseBoolean(
    'PGSSL_REJECT_UNAUTHORIZED',
    process.env.PGSSL_REJECT_UNAUTHORIZED,
    sslMode === 'verify-full' || sslMode === 'verify-ca',
  );

  const sslCa = ssl ? readSslCa() : undefined;

  const maxRows = requireRange(
    'PG_MAX_ROWS',
    parseInteger('PG_MAX_ROWS', process.env.PG_MAX_ROWS, 500),
    1,
    10_000,
  );

  const maxResultBytes = requireRange(
    'PG_MAX_RESULT_BYTES',
    parseInteger('PG_MAX_RESULT_BYTES', process.env.PG_MAX_RESULT_BYTES, 1_048_576),
    1_024,
    10_485_760,
  );

  const queryTimeoutMs = requireRange(
    'PG_QUERY_TIMEOUT_MS',
    parseInteger('PG_QUERY_TIMEOUT_MS', process.env.PG_QUERY_TIMEOUT_MS, 10_000),
    1_000,
    120_000,
  );

  const connectTimeoutMs = requireRange(
    'PG_CONNECT_TIMEOUT_MS',
    parseInteger('PG_CONNECT_TIMEOUT_MS', process.env.PG_CONNECT_TIMEOUT_MS, 10_000),
    1_000,
    120_000,
  );

  const maxAffectedRows = requireRange(
    'PG_MAX_AFFECTED_ROWS',
    parseInteger('PG_MAX_AFFECTED_ROWS', process.env.PG_MAX_AFFECTED_ROWS, 1_000),
    0,
    1_000_000,
  );

  const password = readPassword();

  return {
    mode,
    ...(connectionString ? { connectionString } : {}),
    host,
    port,
    username,
    ...(password !== undefined ? { password } : {}),
    database,
    ssl,
    sslRejectUnauthorized,
    ...(sslCa ? { sslCa } : {}),
    maxRows,
    maxResultBytes,
    queryTimeoutMs,
    connectTimeoutMs,
    maxAffectedRows,
  };
}

export const helpText = `Usage: mcp-postgres [--mode=readonly|write|admin]

Modes:
  readonly  Allow SELECT/SHOW/EXPLAIN only (default).
  write     Allow reads, DML, and safe DDL (CREATE/ALTER).
  admin     Allow any single PostgreSQL statement, including DROP and role administration.

The PostgreSQL account still needs the corresponding database privileges.\n`;
