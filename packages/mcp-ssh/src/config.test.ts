import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveConnectionOptions,
  resolveExecutionLimits,
  SshConfigurationError,
} from './config.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

beforeEach(() => {
  process.env.MCP_SSH_HOST_FINGERPRINT = 'SHA256:test';
  delete process.env.MCP_SSH_HOST_KEY_POLICY;
  delete process.env.MCP_SSH_KNOWN_HOSTS_PATH;
});

describe('resolveConnectionOptions', () => {
  it('prefers per-call values over environment defaults', () => {
    process.env.MCP_SSH_HOST = 'env.example.com';
    process.env.MCP_SSH_USERNAME = 'env-user';
    process.env.MCP_SSH_PASSWORD = 'env-password';

    expect(
      resolveConnectionOptions({
        host: 'call.example.com',
        username: 'call-user',
        password: 'call-password',
      }),
    ).toMatchObject({
      host: 'call.example.com',
      username: 'call-user',
      password: 'call-password',
      port: 22,
      hostKeyPolicy: 'disabled',
    });
  });

  it('requires host, username, and authentication', () => {
    expect(() => resolveConnectionOptions({})).toThrow(SshConfigurationError);

    expect(() => resolveConnectionOptions({ host: 'example.com', username: 'user' })).toThrow(
      'Missing SSH authentication',
    );
  });

  it('allows host key verification to be disabled per call', () => {
    delete process.env.MCP_SSH_HOST_FINGERPRINT;

    expect(
      resolveConnectionOptions({
        host: 'example.com',
        username: 'user',
        password: 'password',
        hostKeyPolicy: 'disabled',
      }),
    ).toMatchObject({
      hostKeyPolicy: 'disabled',
    });
  });

  it('supports known_hosts verification without a fingerprint', () => {
    delete process.env.MCP_SSH_HOST_FINGERPRINT;
    process.env.MCP_SSH_HOST_KEY_POLICY = 'known_hosts';
    process.env.MCP_SSH_KNOWN_HOSTS_PATH = 'C:/Users/test/.ssh/known_hosts';

    expect(
      resolveConnectionOptions({
        host: 'example.com',
        username: 'user',
        password: 'password',
      }),
    ).toMatchObject({
      hostKeyPolicy: 'known_hosts',
      knownHostsPath: 'C:/Users/test/.ssh/known_hosts',
    });
  });

  it('requires a fingerprint when strict policy is explicitly selected', () => {
    delete process.env.MCP_SSH_HOST_FINGERPRINT;

    expect(() =>
      resolveConnectionOptions({
        host: 'example.com',
        username: 'user',
        password: 'password',
        hostKeyPolicy: 'strict',
      }),
    ).toThrow('Missing SSH host fingerprint');
  });

  it('rejects an unknown host key policy', () => {
    expect(() =>
      resolveConnectionOptions({
        host: 'example.com',
        username: 'user',
        password: 'password',
        hostKeyPolicy: 'unknown' as never,
      }),
    ).toThrow('must be strict, known_hosts, or disabled');
  });
});

describe('resolveExecutionLimits', () => {
  it('uses safe defaults', () => {
    expect(resolveExecutionLimits({})).toEqual({
      timeoutMs: 30_000,
      maxOutputBytes: 1_048_576,
    });
  });

  it('rejects an excessive output limit', () => {
    expect(() => resolveExecutionLimits({ maxOutputBytes: 10_485_761 })).toThrow('maxOutputBytes');
  });
});
