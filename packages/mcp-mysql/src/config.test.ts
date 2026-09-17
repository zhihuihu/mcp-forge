import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig, parseCliOptions, MysqlConfigurationError } from './config.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('parseCliOptions', () => {
  it('parses the mode flag in both forms', () => {
    expect(parseCliOptions(['--mode=admin'])).toEqual({ help: false, mode: 'admin' });
    expect(parseCliOptions(['--mode', 'write'])).toEqual({ help: false, mode: 'write' });
  });

  it('replaces the old admin flag with the mode switch', () => {
    expect(() => parseCliOptions(['--allow_admin_query'])).toThrow(MysqlConfigurationError);
    expect(() => parseCliOptions(['--allow_write_query'])).toThrow('--mode=write');
  });
});

describe('loadConfig', () => {
  it('uses readonly mode and safe defaults', () => {
    process.env.MYSQL_USER = 'mcp_reader';

    expect(loadConfig([])).toMatchObject({
      mode: 'readonly',
      host: '127.0.0.1',
      port: 3306,
      username: 'mcp_reader',
      maxRows: 500,
      maxResultBytes: 1_048_576,
    });
  });

  it('lets the CLI mode override MYSQL_MODE', () => {
    process.env.MYSQL_USER = 'mcp_admin';
    process.env.MYSQL_MODE = 'readonly';

    expect(loadConfig(['--mode=admin']).mode).toBe('admin');
  });

  it('requires the database username', () => {
    delete process.env.MYSQL_USER;
    delete process.env.MYSQL_URL;
    delete process.env.DATABASE_URL;
    expect(() => loadConfig([])).toThrow('MYSQL_USER is required');
  });

  it('parses MYSQL_URL connection string', () => {
    delete process.env.MYSQL_USER;
    process.env.MYSQL_URL = 'mysql://cloud_user:secret_pass@mysql.cloud.internal:3307/production_db?ssl=true';

    const config = loadConfig([]);
    expect(config.username).toBe('cloud_user');
    expect(config.password).toBe('secret_pass');
    expect(config.host).toBe('mysql.cloud.internal');
    expect(config.port).toBe(3307);
    expect(config.database).toBe('production_db');
    expect(config.ssl).toBe(true);
  });

  it('supports DATABASE_URL and honors explicit env var overrides', () => {
    delete process.env.MYSQL_USER;
    process.env.DATABASE_URL = 'mysql://url_user:url_pass@remote.db:3306/urldb';
    process.env.MYSQL_USER = 'override_user';
    process.env.MYSQL_DATABASE = 'override_db';

    const config = loadConfig([]);
    expect(config.username).toBe('override_user');
    expect(config.password).toBe('url_pass');
    expect(config.host).toBe('remote.db');
    expect(config.database).toBe('override_db');
  });

  it('auto-enables SSL for cloud domains like tidbcloud.com', () => {
    delete process.env.MYSQL_USER;
    process.env.MYSQL_URL = 'mysql://tidb_user:pass@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/app';

    const config = loadConfig([]);
    expect(config.ssl).toBe(true);
    expect(config.port).toBe(4000);
  });

  it('throws on invalid URL or invalid port', () => {
    delete process.env.MYSQL_USER;
    process.env.MYSQL_URL = 'not-a-valid-url';
    expect(() => loadConfig([])).toThrow(MysqlConfigurationError);

    process.env.MYSQL_URL = 'mysql://user:pass@localhost:0/db';
    expect(() => loadConfig([])).toThrow('Invalid port');
  });
});
