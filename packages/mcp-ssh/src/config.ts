import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type SshHostKeyPolicy = 'strict' | 'known_hosts' | 'disabled';

export interface SshToolInput {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  hostFingerprint?: string;
  hostKeyPolicy?: SshHostKeyPolicy;
  knownHostsPath?: string;
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface SshConnectionOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  hostFingerprint?: string;
  hostKeyPolicy: SshHostKeyPolicy;
  knownHostsPath?: string;
  agent?: string;
  readyTimeout: number;
}

export class SshConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshConfigurationError';
  }
}

function optionalNonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

function parseHostKeyPolicy(value: string | undefined, source: string): SshHostKeyPolicy {
  const normalized = optionalNonEmpty(value)?.toLowerCase() ?? 'disabled';
  if (normalized === 'strict' || normalized === 'known_hosts' || normalized === 'disabled') {
    return normalized;
  }
  throw new SshConfigurationError(
    `${source} must be strict, known_hosts, or disabled; received: ${value}`,
  );
}

function defaultKnownHostsPath(): string {
  return join(homedir(), '.ssh', 'known_hosts');
}

function readPrivateKeyFromEnvironment(): string | undefined {
  const inlineKey = optionalNonEmpty(process.env.MCP_SSH_PRIVATE_KEY);
  if (inlineKey) {
    return inlineKey;
  }

  const keyPath = optionalNonEmpty(process.env.MCP_SSH_PRIVATE_KEY_PATH);
  if (!keyPath) {
    return undefined;
  }

  try {
    return readFileSync(keyPath, 'utf8');
  } catch {
    throw new SshConfigurationError(
      `Unable to read the private key configured by MCP_SSH_PRIVATE_KEY_PATH: ${keyPath}`,
    );
  }
}

export function resolveConnectionOptions(input: SshToolInput): SshConnectionOptions {
  const host = optionalNonEmpty(input.host) ?? optionalNonEmpty(process.env.MCP_SSH_HOST);
  const username =
    optionalNonEmpty(input.username) ?? optionalNonEmpty(process.env.MCP_SSH_USERNAME);
  const port = input.port ?? Number.parseInt(process.env.MCP_SSH_PORT ?? '22', 10);
  const timeoutMs =
    input.timeoutMs ?? Number.parseInt(process.env.MCP_SSH_TIMEOUT_MS ?? '30000', 10);
  const password =
    optionalNonEmpty(input.password) ?? optionalNonEmpty(process.env.MCP_SSH_PASSWORD);
  const privateKey = optionalNonEmpty(input.privateKey) ?? readPrivateKeyFromEnvironment();
  const passphrase =
    optionalNonEmpty(input.passphrase) ?? optionalNonEmpty(process.env.MCP_SSH_PASSPHRASE);
  const hostFingerprint =
    optionalNonEmpty(input.hostFingerprint) ??
    optionalNonEmpty(process.env.MCP_SSH_HOST_FINGERPRINT);
  const hostKeyPolicy = parseHostKeyPolicy(
    input.hostKeyPolicy ?? process.env.MCP_SSH_HOST_KEY_POLICY,
    'MCP_SSH_HOST_KEY_POLICY',
  );
  const knownHostsPath =
    optionalNonEmpty(input.knownHostsPath) ??
    optionalNonEmpty(process.env.MCP_SSH_KNOWN_HOSTS_PATH) ??
    defaultKnownHostsPath();
  const agent =
    optionalNonEmpty(process.env.MCP_SSH_AUTH_SOCK) ?? optionalNonEmpty(process.env.SSH_AUTH_SOCK);

  if (!host) {
    throw new SshConfigurationError('Missing SSH host. Pass host or set MCP_SSH_HOST.');
  }
  if (!username) {
    throw new SshConfigurationError('Missing SSH username. Pass username or set MCP_SSH_USERNAME.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new SshConfigurationError('SSH port must be an integer between 1 and 65535.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new SshConfigurationError('timeoutMs must be an integer between 1000 and 120000.');
  }
  if (hostKeyPolicy === 'strict' && !hostFingerprint) {
    throw new SshConfigurationError(
      'Missing SSH host fingerprint. Pass hostFingerprint or set MCP_SSH_HOST_FINGERPRINT.',
    );
  }
  if (!password && !privateKey && !agent) {
    throw new SshConfigurationError(
      'Missing SSH authentication. Provide password/privateKey or configure MCP_SSH_PRIVATE_KEY_PATH or SSH_AUTH_SOCK.',
    );
  }

  return {
    host,
    port,
    username,
    ...(password ? { password } : {}),
    ...(privateKey ? { privateKey } : {}),
    ...(passphrase ? { passphrase } : {}),
    ...(hostFingerprint ? { hostFingerprint } : {}),
    hostKeyPolicy,
    ...(hostKeyPolicy === 'known_hosts' ? { knownHostsPath } : {}),
    ...(agent ? { agent } : {}),
    readyTimeout: timeoutMs,
  };
}

export function resolveExecutionLimits(input: SshToolInput): {
  timeoutMs: number;
  maxOutputBytes: number;
} {
  const timeoutMs =
    input.timeoutMs ?? Number.parseInt(process.env.MCP_SSH_TIMEOUT_MS ?? '30000', 10);
  const maxOutputBytes = input.maxOutputBytes ?? 1_048_576;

  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 10_485_760) {
    throw new SshConfigurationError('maxOutputBytes must be an integer between 1 and 10485760.');
  }

  return { timeoutMs, maxOutputBytes };
}
