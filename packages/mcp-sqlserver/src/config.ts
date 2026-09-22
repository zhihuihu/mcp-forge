import { readFileSync } from 'node:fs';

import type { SqlserverConfig, SqlserverMode } from './types.js';

export class SqlserverConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlserverConfigurationError';
  }
}

export interface CliOptions {
  help: boolean;
  mode?: SqlserverMode | undefined;
  host?: string | undefined;
  port?: number | undefined;
  user?: string | undefined;
  password?: string | undefined;
  database?: string | undefined;
  instanceName?: string | undefined;
  domain?: string | undefined;
  encrypt?: boolean | undefined;
  trustServerCertificate?: boolean | undefined;
  connectionString?: string | undefined;
  maxRows?: number | undefined;
  maxResultBytes?: number | undefined;
  queryTimeoutMs?: number | undefined;
  connectTimeoutMs?: number | undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseMode(value: string | undefined, source: string): SqlserverMode | undefined {
  const normalized = nonEmpty(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'readonly' || normalized === 'write' || normalized === 'admin') {
    return normalized;
  }
  throw new SqlserverConfigurationError(
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
    throw new SqlserverConfigurationError(`${name} must be an integer; received: ${value}`);
  }
  return parsed;
}

function requireRange(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new SqlserverConfigurationError(
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
  throw new SqlserverConfigurationError(`${name} must be true or false; received: ${value}`);
}

function readPassword(cliPassword?: string, urlPassword?: string): string {
  if (cliPassword !== undefined) {
    return cliPassword;
  }
  const directPassword = process.env.SQLSERVER_PASSWORD ?? process.env.MSSQL_PASSWORD;
  if (directPassword !== undefined) {
    return directPassword;
  }

  const passwordFile = nonEmpty(process.env.SQLSERVER_PASSWORD_FILE ?? process.env.MSSQL_PASSWORD_FILE);
  if (!passwordFile) {
    return urlPassword ?? '';
  }

  try {
    return readFileSync(passwordFile, 'utf8').trimEnd();
  } catch {
    throw new SqlserverConfigurationError(
      `Unable to read the password configured by password file: ${passwordFile}`,
    );
  }
}

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new SqlserverConfigurationError(`${option} requires a value.`);
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
      options.port = parseInteger('--port', argument.slice('--port='.length), 1433);
      continue;
    }
    if (argument === '--port') {
      options.port = parseInteger('--port', optionValue(args, index, '--port'), 1433);
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

    if (argument.startsWith('--instance-name=')) {
      options.instanceName = argument.slice('--instance-name='.length);
      continue;
    }
    if (argument === '--instance-name') {
      options.instanceName = optionValue(args, index, '--instance-name');
      index += 1;
      continue;
    }

    if (argument.startsWith('--domain=')) {
      options.domain = argument.slice('--domain='.length);
      continue;
    }
    if (argument === '--domain') {
      options.domain = optionValue(args, index, '--domain');
      index += 1;
      continue;
    }

    if (argument.startsWith('--encrypt=')) {
      options.encrypt = parseBoolean('--encrypt', argument.slice('--encrypt='.length), false);
      continue;
    }
    if (argument === '--encrypt') {
      options.encrypt = true;
      continue;
    }

    if (argument.startsWith('--trust-server-certificate=')) {
      options.trustServerCertificate = parseBoolean(
        '--trust-server-certificate',
        argument.slice('--trust-server-certificate='.length),
        true,
      );
      continue;
    }
    if (argument === '--trust-server-certificate') {
      options.trustServerCertificate = true;
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

    throw new SqlserverConfigurationError(`Unknown command-line option: ${argument}`);
  }

  return { help, ...options };
}

interface ParsedUrlConfig {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  encrypt?: boolean;
}

function parseUrlConfig(rawUrl: string): ParsedUrlConfig {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SqlserverConfigurationError(`Invalid database connection URL: ${rawUrl}`);
  }

  const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  const host = parsed.hostname ? parsed.hostname : undefined;
  const port = parsed.port ? Number(parsed.port) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new SqlserverConfigurationError(`Invalid port in database connection URL: ${parsed.port}`);
  }
  const cleanPath = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
  const database = cleanPath ? decodeURIComponent(cleanPath) : undefined;

  const encryptParam = parsed.searchParams.get('encrypt');
  const encrypt = encryptParam ? encryptParam.toLowerCase() === 'true' : undefined;

  return {
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(host ? { host } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(database ? { database } : {}),
    ...(encrypt !== undefined ? { encrypt } : {}),
  };
}

export function loadConfig(args: readonly string[] = process.argv.slice(2)): SqlserverConfig {
  const cli = parseCliOptions(args);
  const mode =
    cli.mode ??
    parseMode(process.env.SQLSERVER_MODE ?? process.env.MSSQL_MODE, 'SQLSERVER_MODE') ??
    'readonly';

  const rawUrl = nonEmpty(
    cli.connectionString ??
      process.env.SQLSERVER_CONNECTION_STRING ??
      process.env.MSSQL_CONNECTION_STRING ??
      process.env.DATABASE_URL,
  );
  const urlConfig = rawUrl ? parseUrlConfig(rawUrl) : undefined;

  const user =
    cli.user ??
    nonEmpty(process.env.SQLSERVER_USER ?? process.env.MSSQL_USER) ??
    urlConfig?.username;

  const port = requireRange(
    'SQLSERVER_PORT',
    cli.port ??
      parseInteger(
        'SQLSERVER_PORT',
        process.env.SQLSERVER_PORT ?? process.env.MSSQL_PORT,
        urlConfig?.port ?? 1433,
      ),
    1,
    65_535,
  );

  const maxRows = requireRange(
    'SQLSERVER_MAX_ROWS',
    parseInteger('SQLSERVER_MAX_ROWS', process.env.SQLSERVER_MAX_ROWS ?? process.env.MSSQL_MAX_ROWS, 500),
    1,
    10_000,
  );
  const maxResultBytes = requireRange(
    'SQLSERVER_MAX_RESULT_BYTES',
    parseInteger(
      'SQLSERVER_MAX_RESULT_BYTES',
      process.env.SQLSERVER_MAX_RESULT_BYTES ?? process.env.MSSQL_MAX_RESULT_BYTES,
      1_048_576,
    ),
    1_024,
    10_485_760,
  );
  const queryTimeoutMs = requireRange(
    'SQLSERVER_QUERY_TIMEOUT_MS',
    parseInteger(
      'SQLSERVER_QUERY_TIMEOUT_MS',
      process.env.SQLSERVER_QUERY_TIMEOUT_MS ?? process.env.MSSQL_QUERY_TIMEOUT_MS,
      15_000,
    ),
    1_000,
    120_000,
  );
  const connectTimeoutMs = requireRange(
    'SQLSERVER_CONNECT_TIMEOUT_MS',
    parseInteger(
      'SQLSERVER_CONNECT_TIMEOUT_MS',
      process.env.SQLSERVER_CONNECT_TIMEOUT_MS ?? process.env.MSSQL_CONNECT_TIMEOUT_MS,
      15_000,
    ),
    1_000,
    120_000,
  );
  const maxAffectedRows = requireRange(
    'SQLSERVER_MAX_AFFECTED_ROWS',
    parseInteger(
      'SQLSERVER_MAX_AFFECTED_ROWS',
      process.env.SQLSERVER_MAX_AFFECTED_ROWS ?? process.env.MSSQL_MAX_AFFECTED_ROWS,
      1_000,
    ),
    0,
    1_000_000,
  );

  const host =
    cli.host ??
    nonEmpty(process.env.SQLSERVER_HOST ?? process.env.MSSQL_HOST) ??
    urlConfig?.host ??
    '127.0.0.1';

  const database =
    cli.database ??
    nonEmpty(process.env.SQLSERVER_DATABASE ?? process.env.MSSQL_DATABASE) ??
    urlConfig?.database;

  const instanceName =
    cli.instanceName ??
    nonEmpty(process.env.SQLSERVER_INSTANCE_NAME ?? process.env.MSSQL_INSTANCE_NAME);

  const domain =
    cli.domain ??
    nonEmpty(process.env.SQLSERVER_DOMAIN ?? process.env.MSSQL_DOMAIN);

  const password = readPassword(cli.password, urlConfig?.password);

  const encrypt =
    cli.encrypt ??
    parseBoolean(
      'SQLSERVER_ENCRYPT',
      process.env.SQLSERVER_ENCRYPT ?? process.env.MSSQL_ENCRYPT,
      urlConfig?.encrypt ?? false,
    );

  const trustServerCertificate =
    cli.trustServerCertificate ??
    parseBoolean(
      'SQLSERVER_TRUST_SERVER_CERTIFICATE',
      process.env.SQLSERVER_TRUST_SERVER_CERTIFICATE ?? process.env.MSSQL_TRUST_SERVER_CERTIFICATE,
      true,
    );

  return {
    mode,
    host,
    port,
    user,
    password,
    ...(database ? { database } : {}),
    ...(instanceName ? { instanceName } : {}),
    ...(domain ? { domain } : {}),
    encrypt,
    trustServerCertificate,
    maxRows,
    maxResultBytes,
    queryTimeoutMs,
    connectTimeoutMs,
    maxAffectedRows,
    ...(rawUrl ? { connectionString: rawUrl } : {}),
  };
}

export const helpText = `Usage: mcp-sqlserver [options]

Options:
  --help, -h                    Show this help message
  --mode=<mode>                 Security mode: readonly (default), write, or admin
  --host, --server <host>       SQL Server host (default: 127.0.0.1)
  --port <port>                 SQL Server port (default: 1433)
  --user, -u <user>             Database username
  --password, -p <password>     Database password
  --database, -d <database>     Database name
  --instance-name <instance>    Named instance (e.g. SQLEXPRESS)
  --domain <domain>             Windows domain for NTLM authentication
  --encrypt                     Enable TLS/SSL encryption (default: false)
  --trust-server-certificate    Trust server certificate (default: true)
  --connection-string <url>     Connection URL (e.g. mssql://user:pass@host:1433/db)

Environment Variables:
  SQLSERVER_HOST, SQLSERVER_PORT, SQLSERVER_USER, SQLSERVER_PASSWORD,
  SQLSERVER_DATABASE, SQLSERVER_MODE, SQLSERVER_ENCRYPT,
  SQLSERVER_TRUST_SERVER_CERTIFICATE, SQLSERVER_CONNECTION_STRING
`;
