import { readFileSync } from 'node:fs';

import type { MysqlConfig, MysqlMode } from './types.js';

export class MysqlConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MysqlConfigurationError';
  }
}

export interface CliOptions {
  help: boolean;
  mode?: MysqlMode;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseMode(value: string | undefined, source: string): MysqlMode | undefined {
  const normalized = nonEmpty(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'readonly' || normalized === 'write' || normalized === 'admin') {
    return normalized;
  }
  throw new MysqlConfigurationError(
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
    throw new MysqlConfigurationError(`${name} must be an integer; received: ${value}`);
  }
  return parsed;
}

function requireRange(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new MysqlConfigurationError(
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
  throw new MysqlConfigurationError(`${name} must be true or false; received: ${value}`);
}

function readPassword(): string {
  const directPassword = process.env.MYSQL_PASSWORD;
  if (directPassword !== undefined) {
    return directPassword;
  }

  const passwordFile = nonEmpty(process.env.MYSQL_PASSWORD_FILE);
  if (!passwordFile) {
    return '';
  }

  try {
    return readFileSync(passwordFile, 'utf8').trimEnd();
  } catch {
    throw new MysqlConfigurationError(
      `Unable to read the password configured by MYSQL_PASSWORD_FILE: ${passwordFile}`,
    );
  }
}

function readSslCa(): string | undefined {
  const sslCaPath = nonEmpty(process.env.MYSQL_SSL_CA);
  if (!sslCaPath) {
    return undefined;
  }

  try {
    return readFileSync(sslCaPath, 'utf8');
  } catch {
    throw new MysqlConfigurationError(`Unable to read MYSQL_SSL_CA: ${sslCaPath}`);
  }
}

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new MysqlConfigurationError(`${option} requires a value.`);
  }
  return value;
}

export function parseCliOptions(args: readonly string[] = process.argv.slice(2)): CliOptions {
  let help = false;
  let mode: MysqlMode | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }

    if (argument === '--allow_admin_query' || argument.startsWith('--allow_admin_query=')) {
      throw new MysqlConfigurationError(
        '--allow_admin_query is not supported. Use --mode=admin (or MYSQL_MODE=admin).',
      );
    }

    if (argument === '--allow_write_query' || argument.startsWith('--allow_write_query=')) {
      throw new MysqlConfigurationError(
        '--allow_write_query is not supported. Use --mode=write (or MYSQL_MODE=write).',
      );
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

    throw new MysqlConfigurationError(`Unknown command-line option: ${argument}`);
  }

  return { help, ...(mode ? { mode } : {}) };
}

export function loadConfig(args: readonly string[] = process.argv.slice(2)): MysqlConfig {
  const cli = parseCliOptions(args);
  const mode = cli.mode ?? parseMode(process.env.MYSQL_MODE, 'MYSQL_MODE') ?? 'readonly';
  const username = nonEmpty(process.env.MYSQL_USER);

  if (!username) {
    throw new MysqlConfigurationError('MYSQL_USER is required.');
  }

  const port = requireRange(
    'MYSQL_PORT',
    parseInteger('MYSQL_PORT', process.env.MYSQL_PORT, 3306),
    1,
    65_535,
  );
  const maxRows = requireRange(
    'MYSQL_MAX_ROWS',
    parseInteger('MYSQL_MAX_ROWS', process.env.MYSQL_MAX_ROWS, 500),
    1,
    10_000,
  );
  const maxResultBytes = requireRange(
    'MYSQL_MAX_RESULT_BYTES',
    parseInteger('MYSQL_MAX_RESULT_BYTES', process.env.MYSQL_MAX_RESULT_BYTES, 1_048_576),
    1_024,
    10_485_760,
  );
  const queryTimeoutMs = requireRange(
    'MYSQL_QUERY_TIMEOUT_MS',
    parseInteger('MYSQL_QUERY_TIMEOUT_MS', process.env.MYSQL_QUERY_TIMEOUT_MS, 10_000),
    1_000,
    120_000,
  );
  const connectTimeoutMs = requireRange(
    'MYSQL_CONNECT_TIMEOUT_MS',
    parseInteger('MYSQL_CONNECT_TIMEOUT_MS', process.env.MYSQL_CONNECT_TIMEOUT_MS, 10_000),
    1_000,
    120_000,
  );
  const maxAffectedRows = requireRange(
    'MYSQL_MAX_AFFECTED_ROWS',
    parseInteger('MYSQL_MAX_AFFECTED_ROWS', process.env.MYSQL_MAX_AFFECTED_ROWS, 1_000),
    0,
    1_000_000,
  );
  const host = nonEmpty(process.env.MYSQL_HOST) ?? '127.0.0.1';
  const database = nonEmpty(process.env.MYSQL_DATABASE);
  const ssl = parseBoolean('MYSQL_SSL', process.env.MYSQL_SSL, false);
  const sslCa = ssl ? readSslCa() : undefined;

  return {
    mode,
    host,
    port,
    username,
    password: readPassword(),
    ...(database ? { database } : {}),
    ssl,
    ...(sslCa ? { sslCa } : {}),
    maxRows,
    maxResultBytes,
    queryTimeoutMs,
    connectTimeoutMs,
    maxAffectedRows,
  };
}

export const helpText = `Usage: mcp-mysql [--mode=readonly|write|admin]

Modes:
  readonly  Allow SELECT/SHOW/DESCRIBE/EXPLAIN only (default).
  write     Allow reads, DML, and ordinary DDL.
  admin     Allow any single MySQL statement, including account administration.

The MySQL account still needs the corresponding database privileges.\n`;
