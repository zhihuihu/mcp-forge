import { createHash } from 'node:crypto';

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

function connectConfig(connection: SshConnectionOptions, timeoutMs: number): ConnectConfig {
  const { hostFingerprint, ...sshConnection } = connection;
  const expectedFingerprint = normalizedFingerprint(hostFingerprint);

  return {
    ...sshConnection,
    readyTimeout: timeoutMs,
    hostVerifier: (key: Buffer): boolean =>
      fingerprintForHostKey(key) === expectedFingerprint,
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
