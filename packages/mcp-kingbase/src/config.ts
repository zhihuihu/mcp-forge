import { readFileSync } from 'node:fs';

import type { KingbaseConfig, KingbaseMode } from './types.js';

export class KingbaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KingbaseConfigurationError';
  }
}

export interface CliOptions {
  help: boolean;
  mode?: KingbaseMode | undefined;
  host?: string | undefined;
  port?: number | undefined;
  user?: string | undefined;
  password?: string | undefined;
  database?: string | undefined;
  schema?: string | undefined;
  ssl?: boolean | undefined;
  sslCa?: string | undefined;
  connectionString?: string | undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseMode(value: string | undefined, source: string): KingbaseMode | undefined {
  const normalized = nonEmpty(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'readonly' || normalized === 'write' || normalized === 'admin') {
    return normalized;
  }
  throw new KingbaseConfigurationError(
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
    throw new KingbaseConfigurationError(`${name} must be an integer; received: ${value}`);
  }
  return parsed;
}

function requireRange(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new KingbaseConfigurationError(
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
  throw new KingbaseConfigurationError(`${name} must be true or false; received: ${value}`);
}

function readPassword(cliPassword?: string, urlPassword?: string): string | undefined {
  if (cliPassword !== undefined) {
    return cliPassword;
  }
  const directPassword = process.env.KINGBASE_PASSWORD;
  if (directPassword !== undefined) {
    return directPassword;
  }

  const passwordFile = nonEmpty(process.env.KINGBASE_PASSWORD_FILE);
  if (!passwordFile) {
    return urlPassword;
  }

  try {
    return readFileSync(passwordFile, 'utf8').trimEnd();
  } catch {
    throw new KingbaseConfigurationError(
      `Unable to read the password configured by password file: ${passwordFile}`,
    );
  }
}

function readSslCa(cliSslCa?: string): string | undefined {
  if (cliSslCa !== undefined) {
    try {
      return readFileSync(cliSslCa, 'utf8');
    } catch {
      throw new KingbaseConfigurationError(`Unable to read SSL CA file: ${cliSslCa}`);
    }
  }

  const sslCaPath = nonEmpty(process.env.KINGBASE_SSL_CA);
  if (!sslCaPath) {
    return undefined;
  }

  try {
    return readFileSync(sslCaPath, 'utf8');
  } catch {
    throw new KingbaseConfigurationError(`Unable to read SSL CA file: ${sslCaPath}`);
  }
}

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new KingbaseConfigurationError(`${option} requires a value.`);
  }
  return value;
}

export function parseCliOptions(args: readonly string[] = process.argv.slice(2)): CliOptions {
  let help = false;
  const options: Partial<CliOptions> = {};

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
      options.mode = parseMode(argument.slice('--mode='.length), '--mode');
      continue;
    }
    if (argument === '--mode') {
      options.mode = parseMode(optionValue(args, index, '--mode'), '--mode');
      index += 1;
      continue;
    }

    if (argument.startsWith('--host=')) {
      options.host = argument.slice('--host='.length);
      continue;
    }
    if (argument === '--host' || argument === '--server') {
      options.host = optionValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument.startsWith('--server=')) {
      options.host = argument.slice('--server='.length);
      continue;
    }

    if (argument.startsWith('--port=')) {
      options.port = parseInteger('--port', argument.slice('--port='.length), 54321);
      continue;
    }
    if (argument === '--port') {
      options.port = parseInteger('--port', optionValue(args, index, '--port'), 54321);
      index += 1;
      continue;
    }

    if (argument.startsWith('--user=')) {
      options.user = argument.slice('--user='.length);
      continue;
    }
    if (argument === '--user' || argument === '-u') {
      options.user = optionValue(args, index, argument);
      index += 1;
      continue;
    }

    if (argument.startsWith('--password=')) {
      options.password = argument.slice('--password='.length);
      continue;
    }
    if (argument === '--password' || argument === '-p') {
      options.password = optionValue(args, index, argument);
      index += 1;
      continue;
    }

    if (argument.startsWith('--database=')) {
      options.database = argument.slice('--database='.length);
      continue;
    }
    if (argument === '--database' || argument === '-d') {
      options.database = optionValue(args, index, argument);
      index += 1;
      continue;
    }

    if (argument.startsWith('--schema=')) {
      options.schema = argument.slice('--schema='.length);
      continue;
    }
    if (argument === '--schema') {
      options.schema = optionValue(args, index, '--schema');
      index += 1;
      continue;
    }

    if (argument.startsWith('--ssl=')) {
      options.ssl = parseBoolean('--ssl', argument.slice('--ssl='.length), false);
      continue;
    }
    if (argument === '--ssl') {
      options.ssl = true;
      continue;
    }

    if (argument.startsWith('--ssl-ca=')) {
      options.sslCa = argument.slice('--ssl-ca='.length);
      continue;
    }
    if (argument === '--ssl-ca') {
      options.sslCa = optionValue(args, index, '--ssl-ca');
      index += 1;
      continue;
    }

    if (argument.startsWith('--connection-string=')) {
      options.connectionString = argument.slice('--connection-string='.length);
      continue;
    }
    if (argument === '--connection-string') {
      options.connectionString = optionValue(args, index, '--connection-string');
      index += 1;
      continue;
    }

    throw new KingbaseConfigurationError(`Unknown command-line option: ${argument}`);
  }

  return { help, ...options };
}

interface ParsedUrlConfig {
  host?: string | undefined;
  port?: number | undefined;
  username?: string | undefined;
  password?: string | undefined;
  database?: string | undefined;
  ssl?: boolean | undefined;
}

function parseUrlConfig(rawUrl: string): ParsedUrlConfig {
  let parsed: URL;
  try {
    // Normalise kingbase:// scheme to postgres:// so URL parser handles it cleanly
    const normalizedUrl = rawUrl.replace(/^kingbase:\/\//i, 'postgres://');
    parsed = new URL(normalizedUrl);
  } catch {
    throw new KingbaseConfigurationError(`Invalid database connection URL: ${rawUrl}`);
  }

  const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  const host = parsed.hostname ? parsed.hostname : undefined;
  const port = parsed.port ? Number(parsed.port) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new KingbaseConfigurationError(`Invalid port in database connection URL: ${parsed.port}`);
  }
  const cleanPath = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
  const database = cleanPath ? decodeURIComponent(cleanPath) : undefined;

  const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();
  const sslParam = parsed.searchParams.get('ssl')?.toLowerCase();
  const ssl =
    sslMode === 'require' ||
    sslMode === 'verify-ca' ||
    sslMode === 'verify-full' ||
    sslParam === 'true' ||
    sslParam === '1' ||
    undefined;

  return {
    username,
    password,
    host,
    port,
    database,
    ssl,
  };
}

export function loadConfig(args: readonly string[] = process.argv.slice(2)): KingbaseConfig {
  const cli = parseCliOptions(args);
  const mode =
    cli.mode ??
    parseMode(process.env.KINGBASE_MODE, 'KINGBASE_MODE') ??
    'readonly';

  const rawUrl = nonEmpty(
    cli.connectionString ??
      process.env.KINGBASE_CONNECTION_STRING ??
      process.env.DATABASE_URL,
  );
  const urlConfig = rawUrl ? parseUrlConfig(rawUrl) : undefined;

  const user =
    cli.user ??
    nonEmpty(process.env.KINGBASE_USER) ??
    urlConfig?.username ??
    'system';

  const host =
    cli.host ??
    nonEmpty(process.env.KINGBASE_HOST) ??
    urlConfig?.host ??
    '127.0.0.1';

  const port = requireRange(
    'KINGBASE_PORT',
    cli.port ??
      parseInteger(
        'KINGBASE_PORT',
        process.env.KINGBASE_PORT,
        urlConfig?.port ?? 54321,
      ),
    1,
    65_535,
  );

  const database =
    cli.database ??
    nonEmpty(process.env.KINGBASE_DATABASE) ??
    urlConfig?.database ??
    'TEST';

  const schema =
    cli.schema ??
    nonEmpty(process.env.KINGBASE_SCHEMA);

  const ssl =
    cli.ssl ??
    parseBoolean(
      'KINGBASE_SSL',
      process.env.KINGBASE_SSL,
      urlConfig?.ssl ?? false,
    );

  const sslCa = readSslCa(cli.sslCa);

  const maxRows = requireRange(
    'KINGBASE_MAX_ROWS',
    parseInteger('KINGBASE_MAX_ROWS', process.env.KINGBASE_MAX_ROWS, 500),
    1,
    10_000,
  );

  const maxResultBytes = requireRange(
    'KINGBASE_MAX_RESULT_BYTES',
    parseInteger('KINGBASE_MAX_RESULT_BYTES', process.env.KINGBASE_MAX_RESULT_BYTES, 1_048_576),
    1_024,
    10_485_760,
  );

  const queryTimeoutMs = requireRange(
    'KINGBASE_QUERY_TIMEOUT_MS',
    parseInteger('KINGBASE_QUERY_TIMEOUT_MS', process.env.KINGBASE_QUERY_TIMEOUT_MS, 10_000),
    1_000,
    120_000,
  );

  const connectTimeoutMs = requireRange(
    'KINGBASE_CONNECT_TIMEOUT_MS',
    parseInteger('KINGBASE_CONNECT_TIMEOUT_MS', process.env.KINGBASE_CONNECT_TIMEOUT_MS, 10_000),
    1_000,
    120_000,
  );

  const maxAffectedRows = requireRange(
    'KINGBASE_MAX_AFFECTED_ROWS',
    parseInteger('KINGBASE_MAX_AFFECTED_ROWS', process.env.KINGBASE_MAX_AFFECTED_ROWS, 1_000),
    0,
    1_000_000,
  );

  const password = readPassword(cli.password, urlConfig?.password);

  return {
    mode,
    host,
    port,
    ...(user ? { user } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(database ? { database } : {}),
    ...(schema ? { schema } : {}),
    ssl,
    ...(sslCa ? { sslCa } : {}),
    connectTimeoutMs,
    queryTimeoutMs,
    maxRows,
    maxResultBytes,
    maxAffectedRows,
    ...(rawUrl ? { connectionString: rawUrl } : {}),
  };
}

export const helpText = `Usage: mcp-kingbase [options]

Options:
  --help, -h                    Show this help message
  --mode=<mode>                 Security mode: readonly (default), write, or admin
  --host, --server <host>       KingbaseES host (default: 127.0.0.1)
  --port <port>                 KingbaseES port (default: 54321)
  --user, -u <user>             Database username (default: system)
  --password, -p <password>     Database password
  --database, -d <database>     Database name (default: TEST)
  --schema <schema>             Default search path schema
  --ssl                         Enable SSL connection (default: false)
  --ssl-ca <path>               Path to CA certificate file
  --connection-string <url>     Connection URL (e.g. kingbase://system:pass@host:54321/TEST)

Environment Variables:
  KINGBASE_HOST, KINGBASE_PORT, KINGBASE_USER, KINGBASE_PASSWORD,
  KINGBASE_PASSWORD_FILE, KINGBASE_DATABASE, KINGBASE_SCHEMA,
  KINGBASE_MODE, KINGBASE_SSL, KINGBASE_SSL_CA, KINGBASE_CONNECTION_STRING
`;
