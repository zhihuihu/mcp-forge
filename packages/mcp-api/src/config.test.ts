import { afterEach, describe, expect, it } from 'vitest';

import { ApiConfigurationError, loadConfig, parseCliOptions } from './config.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('parseCliOptions', () => {
  it('parses help flag in short and long form', () => {
    expect(parseCliOptions(['--help'])).toEqual({ help: true });
    expect(parseCliOptions(['-h'])).toEqual({ help: true });
  });

  it('parses spec and base-url flags', () => {
    expect(
      parseCliOptions(['--spec=./api.yaml', '--base-url=http://api.local']),
    ).toMatchObject({
      spec: './api.yaml',
      baseUrl: 'http://api.local',
    });

    expect(
      parseCliOptions(['--spec', 'https://example.com/spec.json', '--base-url', 'https://example.com']),
    ).toMatchObject({
      spec: 'https://example.com/spec.json',
      baseUrl: 'https://example.com',
    });
  });

  it('parses individual and json headers', () => {
    const opts = parseCliOptions([
      '--headers={"X-Global": "1"}',
      '--header=Authorization: Bearer token123',
      '--header=X-Custom: val',
    ]);
    expect(opts.headers).toEqual({
      'X-Global': '1',
      Authorization: 'Bearer token123',
      'X-Custom': 'val',
    });
  });

  it('parses auth shortcuts and filtering tags', () => {
    const opts = parseCliOptions([
      '--auth-token=secret123',
      '--api-key=key456',
      '--api-key-header=X-Service-Key',
      '--include-tags=user,order',
      '--exclude-tags=admin',
      '--include-operations=getPet,addPet',
    ]);
    expect(opts).toMatchObject({
      authToken: 'secret123',
      apiKey: 'key456',
      apiKeyHeader: 'X-Service-Key',
      includeTags: ['user', 'order'],
      excludeTags: ['admin'],
      includeOperations: ['getPet', 'addPet'],
    });
  });

  it('rejects unknown CLI options', () => {
    expect(() => parseCliOptions(['--unknown'])).toThrow(ApiConfigurationError);
  });
});

describe('loadConfig', () => {
  it('requires spec source', () => {
    delete process.env.API_SPEC;
    expect(() => loadConfig([])).toThrow('API_SPEC is required');
  });

  it('loads config from environment variables', () => {
    process.env.API_SPEC = './openapi.yaml';
    process.env.API_BASE_URL = 'http://127.0.0.1:8080/api';
    process.env.API_HEADERS = '{"X-Tenant": "tenant_01"}';
    process.env.API_AUTH_TOKEN = 'tok_abc';
    process.env.API_INCLUDE_TAGS = 'pets,users';
    process.env.API_TIMEOUT_MS = '15000';

    const config = loadConfig([]);
    expect(config.spec).toBe('./openapi.yaml');
    expect(config.baseUrlOverride).toBe('http://127.0.0.1:8080/api');
    expect(config.defaultHeaders).toEqual({
      'X-Tenant': 'tenant_01',
      Authorization: 'Bearer tok_abc',
    });
    expect(config.includeTags).toEqual(['pets', 'users']);
    expect(config.timeoutMs).toBe(15_000);
    expect(config.maxResultBytes).toBe(1_048_576);
  });

  it('CLI options override environment variables', () => {
    process.env.API_SPEC = 'http://env.com/spec.json';
    process.env.API_BASE_URL = 'http://env.com';
    process.env.API_AUTH_TOKEN = 'env_tok';

    const config = loadConfig([
      '--spec=http://cli.com/spec.json',
      '--base-url=http://cli.com',
      '--auth-token=cli_tok',
    ]);
    expect(config.spec).toBe('http://cli.com/spec.json');
    expect(config.baseUrlOverride).toBe('http://cli.com');
    expect(config.defaultHeaders['Authorization']).toBe('Bearer cli_tok');
  });

  it('injects API Key with custom header', () => {
    process.env.API_SPEC = './api.json';
    process.env.API_KEY = 'secret-key';
    process.env.API_KEY_HEADER = 'X-Custom-Key';

    const config = loadConfig([]);
    expect(config.defaultHeaders['X-Custom-Key']).toBe('secret-key');
  });
});
