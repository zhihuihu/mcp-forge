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
    expect(() => loadConfig([])).toThrow('MYSQL_USER is required');
  });
});
