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
    });
  });

  it('requires host, username, and authentication', () => {
    expect(() => resolveConnectionOptions({})).toThrow(SshConfigurationError);

    expect(() => resolveConnectionOptions({ host: 'example.com', username: 'user' })).toThrow(
      'Missing SSH authentication',
    );
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
