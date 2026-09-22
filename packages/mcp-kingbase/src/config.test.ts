import { afterEach, describe, expect, it } from 'vitest';

import { KingbaseConfigurationError, loadConfig, parseCliOptions } from './config.js';

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

  it('parses connection flags', () => {
    expect(
      parseCliOptions([
        '--host', '192.168.1.100',
        '--port', '54321',
        '-u', 'system',
        '-p', 'password123',
        '-d', 'TEST',
        '--schema', 'public',
        '--ssl',
      ]),
    ).toEqual({
      help: false,
      host: '192.168.1.100',
      port: 54321,
      user: 'system',
      password: 'password123',
      database: 'TEST',
      schema: 'public',
      ssl: true,
    });
  });

  it('rejects invalid options', () => {
    expect(() => parseCliOptions(['--invalid'])).toThrow(KingbaseConfigurationError);
  });
});

describe('loadConfig', () => {
  it('uses readonly mode and safe Kingbase defaults', () => {
    delete process.env.DATABASE_URL;
    delete process.env.KINGBASE_HOST;
    delete process.env.KINGBASE_USER;
    delete process.env.KINGBASE_DATABASE;
    delete process.env.KINGBASE_CONNECTION_STRING;

    expect(loadConfig([])).toMatchObject({
      mode: 'readonly',
      host: '127.0.0.1',
      port: 54321,
      user: 'system',
      database: 'TEST',
      maxRows: 500,
      maxResultBytes: 1_048_576,
    });
  });

  it('supports kingbase:// connection string', () => {
    process.env.KINGBASE_CONNECTION_STRING = 'kingbase://myuser:secret@db.kingbase.com:54321/MYDB?ssl=true';

    const config = loadConfig([]);
    expect(config.connectionString).toBe(
      'kingbase://myuser:secret@db.kingbase.com:54321/MYDB?ssl=true',
    );
    expect(config.user).toBe('myuser');
    expect(config.password).toBe('secret');
    expect(config.host).toBe('db.kingbase.com');
    expect(config.port).toBe(54321);
    expect(config.database).toBe('MYDB');
    expect(config.ssl).toBe(true);
  });

  it('lets the CLI mode override KINGBASE_MODE', () => {
    process.env.KINGBASE_MODE = 'readonly';
    expect(loadConfig(['--mode=admin']).mode).toBe('admin');
  });

  it('validates port range', () => {
    expect(() => loadConfig(['--port=99999'])).toThrow(KingbaseConfigurationError);
    expect(() => loadConfig(['--port=0'])).toThrow(KingbaseConfigurationError);
  });
});
