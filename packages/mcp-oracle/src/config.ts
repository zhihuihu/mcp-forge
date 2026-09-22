import { readFileSync } from 'node:fs';

import type { OracleConfig, OracleMode } from './types.js';

export class OracleConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OracleConfigurationError';
  }
}

export interface CliOptions {
  help: boolean;
  mode?: OracleMode | undefined;
  host?: string | undefined;
  port?: number | undefined;
  user?: string | undefined;
  password?: string | undefined;
  serviceName?: string | undefined;
  sid?: string | undefined;
  connectString?: string | undefined;
  schema?: string | undefined;
  thickMode?: boolean | undefined;
  oracleHome?: string | undefined;
  maxRows?: number | undefined;
  maxResultBytes?: number | undefined;
  queryTimeoutMs?: number | undefined;
  connectTimeoutMs?: number | undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseMode(value: string | undefined, source: string): OracleMode | undefined {
  const normalized = nonEmpty(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'readonly' || normalized === 'write' || normalized === 'admin') {
    return normalized;
  }
  throw new OracleConfigurationError(
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
    throw new OracleConfigurationError(`${name} must be an integer; received: ${value}`);
  }
  return parsed;
}

function requireRange(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new OracleConfigurationError(
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
  throw new OracleConfigurationError(`${name} must be true or false; received: ${value}`);
}

function readPassword(cliPassword?: string): string {
  if (cliPassword !== undefined) {
    return cliPassword;
  }
  const directPassword = process.env.ORACLE_PASSWORD ?? process.env.ORACLE_PASS;
  if (directPassword !== undefined) {
    return directPassword;
  }

  const passwordFile = nonEmpty(process.env.ORACLE_PASSWORD_FILE);
  if (!passwordFile) {
    return '';
  }

  try {
    return readFileSync(passwordFile, 'utf8').trimEnd();
  } catch {
    throw new OracleConfigurationError(
      `Unable to read the password configured by ORACLE_PASSWORD_FILE: ${passwordFile}`,
    );
  }
}

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new OracleConfigurationError(`${option} requires a value.`);
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
      options.port = parseInteger('--port', argument.slice('--port='.length), 1521);
      continue;
    }
    if (argument === '--port') {
      options.port = parseInteger('--port', optionValue(args, index, '--port'), 1521);
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

    if (argument.startsWith('--service-name=')) {
      options.serviceName = argument.slice('--service-name='.length);
      continue;
    }
    if (argument === '--service-name') {
      options.serviceName = optionValue(args, index, '--service-name');
      index += 1;
      continue;
    }

    if (argument.startsWith('--sid=')) {
      options.sid = argument.slice('--sid='.length);
      continue;
    }
    if (argument === '--sid') {
      options.sid = optionValue(args, index, '--sid');
      index += 1;
      continue;
    }

    if (argument.startsWith('--connect-string=')) {
      options.connectString = argument.slice('--connect-string='.length);
      continue;
    }
    if (argument === '--connect-string') {
      options.connectString = optionValue(args, index, '--connect-string');
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

    if (argument === '--thick') {
      options.thickMode = true;
      continue;
    }

    if (argument.startsWith('--oracle-home=')) {
      options.oracleHome = argument.slice('--oracle-home='.length);
      continue;
    }
    if (argument === '--oracle-home') {
      options.oracleHome = optionValue(args, index, '--oracle-home');
      index += 1;
      continue;
    }

    throw new OracleConfigurationError(`Unknown command-line option: ${argument}`);
  }

  return { help, ...options };
}

function buildConnectString(
  explicitConnectString?: string,
  host?: string,
  port: number = 1521,
  serviceName?: string,
  sid?: string,
): string {
  if (explicitConnectString) {
    return explicitConnectString;
  }
  const targetHost = host ?? '127.0.0.1';
  if (sid) {
    return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${targetHost})(PORT=${port}))(CONNECT_DATA=(SID=${sid})))`;
  }
  const targetService = serviceName ?? 'XE';
  return `${targetHost}:${port}/${targetService}`;
}

export function loadConfig(args: readonly string[] = process.argv.slice(2)): OracleConfig {
  const cli = parseCliOptions(args);
  const mode =
    cli.mode ??
    parseMode(process.env.ORACLE_MODE, 'ORACLE_MODE') ??
    'readonly';

  const user =
    cli.user ??
    nonEmpty(process.env.ORACLE_USER);

  const password = readPassword(cli.password);

  const host =
    cli.host ??
    nonEmpty(process.env.ORACLE_HOST) ??
    '127.0.0.1';

  const port = requireRange(
    'ORACLE_PORT',
    cli.port ?? parseInteger('ORACLE_PORT', process.env.ORACLE_PORT, 1521),
    1,
    65_535,
  );

  const serviceName =
    cli.serviceName ??
    nonEmpty(process.env.ORACLE_SERVICE_NAME);

  const sid =
    cli.sid ??
    nonEmpty(process.env.ORACLE_SID);

  const explicitConnectString =
    cli.connectString ??
    nonEmpty(process.env.ORACLE_CONNECT_STRING ?? process.env.DATABASE_URL);

  const connectString = buildConnectString(explicitConnectString, host, port, serviceName, sid);

  const schema =
    cli.schema ??
    nonEmpty(process.env.ORACLE_SCHEMA);

  const thickMode =
    cli.thickMode ??
    parseBoolean('ORACLE_THICK_MODE', process.env.ORACLE_THICK_MODE, false);

  const oracleHome =
    cli.oracleHome ??
    nonEmpty(process.env.ORACLE_HOME);

  const maxRows = requireRange(
    'ORACLE_MAX_ROWS',
    parseInteger('ORACLE_MAX_ROWS', process.env.ORACLE_MAX_ROWS, 500),
    1,
    10_000,
  );
  const maxResultBytes = requireRange(
    'ORACLE_MAX_RESULT_BYTES',
    parseInteger('ORACLE_MAX_RESULT_BYTES', process.env.ORACLE_MAX_RESULT_BYTES, 1_048_576),
    1_024,
    10_485_760,
  );
  const queryTimeoutMs = requireRange(
    'ORACLE_QUERY_TIMEOUT_MS',
    parseInteger('ORACLE_QUERY_TIMEOUT_MS', process.env.ORACLE_QUERY_TIMEOUT_MS, 15_000),
    1_000,
    120_000,
  );
  const connectTimeoutMs = requireRange(
    'ORACLE_CONNECT_TIMEOUT_MS',
    parseInteger('ORACLE_CONNECT_TIMEOUT_MS', process.env.ORACLE_CONNECT_TIMEOUT_MS, 15_000),
    1_000,
    120_000,
  );
  const maxAffectedRows = requireRange(
    'ORACLE_MAX_AFFECTED_ROWS',
    parseInteger('ORACLE_MAX_AFFECTED_ROWS', process.env.ORACLE_MAX_AFFECTED_ROWS, 1_000),
    0,
    1_000_000,
  );

  return {
    mode,
    connectString,
    port,
    ...(user !== undefined ? { user } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(host !== undefined ? { host } : {}),
    ...(serviceName !== undefined ? { serviceName } : {}),
    ...(sid !== undefined ? { sid } : {}),
    ...(schema !== undefined ? { schema } : {}),
    ...(thickMode !== undefined ? { thickMode } : {}),
    ...(oracleHome !== undefined ? { oracleHome } : {}),
    maxRows,
    maxResultBytes,
    queryTimeoutMs,
    connectTimeoutMs,
    maxAffectedRows,
  };
}

export const helpText = `Usage: mcp-oracle [options]

Options:
  --help, -h                  Show this help message
  --mode=<mode>               Security mode: readonly (default), write, or admin
  --host, --server <host>     Oracle host (default: 127.0.0.1)
  --port <port>               Oracle port (default: 1521)
  --user, -u <user>           Database username
  --password, -p <password>   Database password
  --service-name <service>    Oracle service name (e.g. ORCLPDB1, XEPDB1)
  --sid <sid>                 Oracle SID (e.g. ORCL, XE)
  --connect-string <connStr>  Direct connection string or Easy Connect URL
  --schema <schema>           Default schema for table listing
  --thick                     Enable thick driver mode (requires Oracle Client)
  --oracle-home <path>        Path to Oracle Client library directory

Environment Variables:
  ORACLE_HOST, ORACLE_PORT, ORACLE_USER, ORACLE_PASSWORD,
  ORACLE_SERVICE_NAME, ORACLE_SID, ORACLE_CONNECT_STRING,
  ORACLE_MODE, ORACLE_SCHEMA, ORACLE_THICK_MODE, ORACLE_HOME
`;
