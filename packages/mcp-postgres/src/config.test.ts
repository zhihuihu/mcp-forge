import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig, parseCliOptions, PostgresConfigurationError } from './config.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('parseCliOptions', () => {
  it('parses the mode flag in both forms', () => {
    expect(parseCliOptions(['--mode=admin'])).toEqual({ help: false, mode: 'admin' });
    expect(parseCliOptions(['--mode', 'write'])).toEqual({ help: false, mode: 'write' });
  });

  it('handles help flag', () => {
    expect(parseCliOptions(['--help'])).toEqual({ help: true });
    expect(parseCliOptions(['-h'])).toEqual({ help: true });
  });

  it('rejects invalid options', () => {
    expect(() => parseCliOptions(['--invalid'])).toThrow(PostgresConfigurationError);
  });
});

describe('loadConfig', () => {
  it('uses readonly mode and safe defaults', () => {
    delete process.env.DATABASE_URL;
    delete process.env.PGHOST;
    delete process.env.PGUSER;
    delete process.env.PGDATABASE;

    expect(loadConfig([])).toMatchObject({
      mode: 'readonly',
      host: '127.0.0.1',
      port: 5432,
      username: 'postgres',
      database: 'postgres',
      maxRows: 500,
      maxResultBytes: 1_048_576,
    });
  });

  it('supports DATABASE_URL connection string and auto-detects SSL', () => {
    process.env.DATABASE_URL = 'postgres://app_user:secret@db.supabase.co:5432/app_db';

    const config = loadConfig([]);
    expect(config.connectionString).toBe(
      'postgres://app_user:secret@db.supabase.co:5432/app_db',
    );
    expect(config.ssl).toBe(true);
  });

  it('lets the CLI mode override PG_MODE', () => {
    process.env.PG_MODE = 'readonly';
    expect(loadConfig(['--mode=admin']).mode).toBe('admin');
  });
});
