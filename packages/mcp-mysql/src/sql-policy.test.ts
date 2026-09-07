import { describe, expect, it } from 'vitest';

import { enforceSqlPolicy, SqlPolicyError } from './sql-policy.js';

describe('MySQL SQL policy', () => {
  it('allows read statements in readonly mode', () => {
    expect(enforceSqlPolicy("SELECT 'DROP TABLE users' AS example;", 'readonly')).toMatchObject({
      kind: 'read',
      firstKeyword: 'SELECT',
    });
  });

  it('rejects DML in readonly mode', () => {
    expect(() => enforceSqlPolicy('UPDATE users SET enabled = 1', 'readonly')).toThrow(
      SqlPolicyError,
    );
  });

  it('allows DML and ordinary DDL in write mode', () => {
    expect(enforceSqlPolicy('UPDATE users SET enabled = 1', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('CREATE TABLE audit_log (id INT)', 'write').kind).toBe('ddl');
  });

  it('rejects account administration in write mode', () => {
    expect(() => enforceSqlPolicy('GRANT SELECT ON app.* TO app_reader', 'write')).toThrow('admin');
  });

  it('allows administrative statements only in admin mode', () => {
    expect(enforceSqlPolicy('GRANT SELECT ON app.* TO app_reader', 'admin').kind).toBe('admin');
    expect(enforceSqlPolicy('CREATE USER app_reader IDENTIFIED BY ?', 'admin').kind).toBe('admin');
  });

  it('rejects stacked statements in every mode', () => {
    expect(() => enforceSqlPolicy('SELECT 1; DELETE FROM users', 'admin')).toThrow(
      'Multiple SQL statements',
    );
    expect(() => enforceSqlPolicy('SELECT 1;;', 'admin')).toThrow('Multiple SQL statements');
  });

  it('does not treat SQL-looking comments or string values as commands', () => {
    expect(enforceSqlPolicy('/* report */ SELECT 1 # trailing comment', 'readonly').kind).toBe(
      'read',
    );
    expect(enforceSqlPolicy("SELECT 'a; b'", 'readonly').kind).toBe('read');
  });

  it('rejects executable MySQL comments', () => {
    expect(() => enforceSqlPolicy('SELECT /*!40101 1 */', 'admin')).toThrow(
      'comments are not allowed',
    );
  });
});
