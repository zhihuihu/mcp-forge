import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';

import type { SshConnectionOptions } from './config.js';

export interface ExecuteOptions {
  connection: SshConnectionOptions;
  command: string;
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
}

export class SshExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshExecutionError';
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandWithWorkingDirectory(command: string, cwd: string | undefined): string {
  return cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
}

function fingerprintForHostKey(key: Buffer): string {
  const digest = createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}

function normalizedFingerprint(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('SHA256:') ? trimmed : `SHA256:${trimmed}`;
}

interface KnownHostsEntry {
  marker?: string;
  patterns: string[];
  keyBase64: string;
}

function parseKnownHosts(content: string): KnownHostsEntry[] {
  const entries: KnownHostsEntry[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const fields = trimmed.split(/\s+/);
    const marker = fields[0]?.startsWith('@') ? fields.shift() : undefined;
    if (fields.length < 3 || !fields[0] || !fields[2]) {
      continue;
    }

    entries.push({
      ...(marker ? { marker } : {}),
      patterns: fields[0].split(','),
      keyBase64: fields[2],
    });
  }

  return entries;
}

function wildcardMatches(pattern: string, value: string): boolean {
  let expression = '^';
  for (const character of pattern) {
    if (character === '*') {
      expression += '.*';
    } else if (character === '?') {
      expression += '.';
    } else {
      expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  expression += '$';
  return new RegExp(expression, 'i').test(value);
}

function hashedHostMatches(pattern: string, target: string): boolean {
  const parts = pattern.split('|');
  const version = parts[1];
  const saltBase64 = parts[2];
  const hashBase64 = parts[3];
  if (parts.length !== 4 || version !== '1' || !saltBase64 || !hashBase64) {
    return false;
  }

  try {
    const salt = Buffer.from(saltBase64, 'base64');
    const expected = Buffer.from(hashBase64, 'base64');
    const actual = createHmac('sha1', salt).update(target).digest();
    return actual.equals(expected);
  } catch {
    return false;
  }
}

function knownHostTargets(host: string, port: number): string[] {
  if (port !== 22) {
    return [`[${host}]:${port}`];
  }
  return host.includes(':') ? [host, `[${host}]`] : [host];
}

function hostPatternMatches(pattern: string, targets: readonly string[]): boolean {
  const negated = pattern.startsWith('!');
  const candidate = negated ? pattern.slice(1) : pattern;
  const matches = targets.some((target) =>
    candidate.startsWith('|1|')
      ? hashedHostMatches(candidate, target)
      : wildcardMatches(candidate, target),
  );
  return negated ? !matches : matches;
}

function entryMatchesHost(entry: KnownHostsEntry, targets: readonly string[]): boolean {
  const positivePatterns = entry.patterns.filter((pattern) => !pattern.startsWith('!'));
  const negativePatterns = entry.patterns.filter((pattern) => pattern.startsWith('!'));

  if (negativePatterns.some((pattern) => !hostPatternMatches(pattern, targets))) {
    return false;
  }

  return positivePatterns.some((pattern) => hostPatternMatches(pattern, targets));
}

export function matchesKnownHosts(
  content: string,
  host: string,
  port: number,
  key: Buffer,
): boolean {
  const expectedKey = key.toString('base64');
  const targets = knownHostTargets(host, port);

  for (const entry of parseKnownHosts(content)) {
    if (!entryMatchesHost(entry, targets)) {
      continue;
    }
    if (entry.marker === '@cert-authority') {
      continue;
    }
    if (entry.marker === '@revoked' && entry.keyBase64 === expectedKey) {
      return false;
    }
    if (entry.keyBase64 === expectedKey) {
      return true;
    }
  }

  return false;
}

function knownHostsVerifier(host: string, port: number, path: string): (key: Buffer) => boolean {
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    throw new SshExecutionError(`Unable to read SSH known_hosts file: ${path}`);
  }

  return (key: Buffer): boolean => matchesKnownHosts(content, host, port, key);
}

function connectConfig(connection: SshConnectionOptions, timeoutMs: number): ConnectConfig {
  const { hostFingerprint, hostKeyPolicy, knownHostsPath, ...sshConnection } = connection;
  const verifier =
    hostKeyPolicy === 'strict'
      ? (key: Buffer): boolean =>
          Boolean(hostFingerprint) &&
          fingerprintForHostKey(key) === normalizedFingerprint(hostFingerprint ?? '')
      : hostKeyPolicy === 'known_hosts'
        ? knownHostsVerifier(connection.host, connection.port, knownHostsPath ?? '')
        : undefined;

  return {
    ...sshConnection,
    readyTimeout: timeoutMs,
    ...(verifier ? { hostVerifier: verifier } : {}),
  };
}

function appendChunk(
  chunks: Buffer[],
  chunk: Buffer,
  state: { bytes: number },
  maxOutputBytes: number,
): void {
  state.bytes += chunk.byteLength;
  if (state.bytes > maxOutputBytes) {
    throw new SshExecutionError(`Remote command output exceeded ${maxOutputBytes} bytes.`);
  }
  chunks.push(chunk);
}

function execOnClient(
  client: Client,
  command: string,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<ExecuteResult> {
  return new Promise((resolve, reject) => {
    let channel: ClientChannel | undefined;
    let settled = false;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const outputState = { bytes: 0 };

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const timer = setTimeout(() => {
      channel?.close();
      finish(() =>
        reject(new SshExecutionError(`Remote command timed out after ${timeoutMs} ms.`)),
      );
    }, timeoutMs);

    client.exec(command, (error, nextChannel) => {
      if (error) {
        finish(() =>
          reject(new SshExecutionError(`Unable to start remote command: ${error.message}`)),
        );
        return;
      }

      channel = nextChannel;
      channel.on('data', (chunk: Buffer) => {
        try {
          appendChunk(stdout, chunk, outputState, maxOutputBytes);
        } catch (chunkError) {
          channel?.close();
          finish(() => reject(chunkError));
        }
      });
      channel.stderr.on('data', (chunk: Buffer) => {
        try {
          appendChunk(stderr, chunk, outputState, maxOutputBytes);
        } catch (chunkError) {
          channel?.close();
          finish(() => reject(chunkError));
        }
      });
      channel.once('error', (channelError: Error) => {
        finish(() => reject(new SshExecutionError(`SSH channel error: ${channelError.message}`)));
      });
      channel.once('close', (code: number | null, signal: string | null) => {
        finish(() =>
          resolve({
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            exitCode: code ?? (signal ? 1 : 0),
            ...(signal ? { signal } : {}),
          }),
        );
      });
    });
  });
}

export async function executeSshCommand(options: ExecuteOptions): Promise<ExecuteResult> {
  const client = new Client();

  try {
    await new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        client.removeListener('error', onError);
        resolve();
      };
      const onError = (error: Error): void => {
        client.removeListener('ready', onReady);
        reject(new SshExecutionError(`SSH connection failed: ${error.message}`));
      };

      client.once('ready', onReady);
      client.once('error', onError);
      client.connect(connectConfig(options.connection, options.timeoutMs));
    });

    return await execOnClient(
      client,
      commandWithWorkingDirectory(options.command, options.cwd),
      options.timeoutMs,
      options.maxOutputBytes,
    );
  } finally {
    client.end();
  }
}

export async function testSshConnection(
  connection: SshConnectionOptions,
  timeoutMs: number,
): Promise<void> {
  const client = new Client();
  try {
    await new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        client.removeListener('error', onError);
        resolve();
      };
      const onError = (error: Error): void => {
        client.removeListener('ready', onReady);
        reject(new SshExecutionError(`SSH connection failed: ${error.message}`));
      };

      client.once('ready', onReady);
      client.once('error', onError);
      client.connect(connectConfig(connection, timeoutMs));
    });
  } finally {
    client.end();
  }
}
