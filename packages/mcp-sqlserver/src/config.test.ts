import { describe, expect, it } from 'vitest';

import { loadConfig, parseCliOptions, SqlserverConfigurationError } from './config.js';

describe('SQL Server config', () => {
  it('parses CLI options correctly', () => {
    const options = parseCliOptions([
      '--host=192.168.1.100',
      '--port=14330',
      '-u',
      'sa',
      '-p',
      'Secret123!',
      '-d',
      'testdb',
      '--mode=write',
    ]);

    expect(options.host).toBe('192.168.1.100');
    expect(options.port).toBe(14330);
    expect(options.user).toBe('sa');
    expect(options.password).toBe('Secret123!');
    expect(options.database).toBe('testdb');
    expect(options.mode).toBe('write');
  });

  it('defaults trustServerCertificate to true and encrypt to false', () => {
    const config = loadConfig(['--host=localhost', '-u', 'sa', '-p', 'pass']);
    expect(config.trustServerCertificate).toBe(true);
    expect(config.encrypt).toBe(false);
    expect(config.mode).toBe('readonly');
  });

  it('parses connection string correctly', () => {
    const config = loadConfig(['--connection-string=mssql://myuser:mypass@dbhost:1433/mydb']);
    expect(config.host).toBe('dbhost');
    expect(config.port).toBe(1433);
    expect(config.user).toBe('myuser');
    expect(config.password).toBe('mypass');
    expect(config.database).toBe('mydb');
  });

  it('rejects invalid modes', () => {
    expect(() => parseCliOptions(['--mode=superadmin'])).toThrow(SqlserverConfigurationError);
  });
});
