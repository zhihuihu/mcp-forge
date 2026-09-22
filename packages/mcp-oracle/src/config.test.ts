import { describe, expect, it } from 'vitest';

import { loadConfig, parseCliOptions, OracleConfigurationError } from './config.js';

describe('Oracle config', () => {
  it('parses CLI options correctly with service name', () => {
    const options = parseCliOptions([
      '--host=dbhost',
      '--port=1522',
      '-u',
      'hr',
      '-p',
      'welcome1',
      '--service-name=ORCLPDB1',
      '--mode=write',
    ]);

    expect(options.host).toBe('dbhost');
    expect(options.port).toBe(1522);
    expect(options.user).toBe('hr');
    expect(options.password).toBe('welcome1');
    expect(options.serviceName).toBe('ORCLPDB1');
    expect(options.mode).toBe('write');
  });

  it('constructs SID descriptor when SID is provided', () => {
    const config = loadConfig(['--host=orclhost', '--sid=ORCL', '-u', 'system']);
    expect(config.connectString).toContain('(CONNECT_DATA=(SID=ORCL))');
    expect(config.connectString).toContain('HOST=orclhost');
  });

  it('constructs serviceName Easy Connect when serviceName is provided', () => {
    const config = loadConfig(['--host=orclhost', '--port=1521', '--service-name=FREEPDB1']);
    expect(config.connectString).toBe('orclhost:1521/FREEPDB1');
  });

  it('rejects invalid modes', () => {
    expect(() => parseCliOptions(['--mode=superadmin'])).toThrow(OracleConfigurationError);
  });
});
