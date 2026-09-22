import { describe, expect, it } from 'vitest';

import { enforceSqlPolicy, SqlPolicyError } from './sql-policy.js';

describe('SQL Server SQL policy', () => {
  it('allows read statements in readonly mode', () => {
    expect(enforceSqlPolicy("SELECT 'DROP TABLE users' AS example;", 'readonly')).toMatchObject({
      kind: 'read',
      firstKeyword: 'SELECT',
    });
    expect(enforceSqlPolicy('SELECT TOP 10 * FROM [dbo].[users]', 'readonly').kind).toBe('read');
  });

  it('supports bracketed identifiers in T-SQL', () => {
    expect(enforceSqlPolicy('SELECT [SELECT], [FROM] FROM [Order Details]', 'readonly').kind).toBe('read');
    expect(enforceSqlPolicy('SELECT [col]]escaped] FROM [table]', 'readonly').kind).toBe('read');
  });

  it('supports nested block comments in T-SQL', () => {
    expect(
      enforceSqlPolicy('/* outer /* inner */ still comment */ SELECT 1', 'readonly').kind,
    ).toBe('read');
  });

  it('rejects DML in readonly mode', () => {
    expect(() => enforceSqlPolicy('UPDATE users SET enabled = 1', 'readonly')).toThrow(
      SqlPolicyError,
    );
    expect(() => enforceSqlPolicy('DELETE FROM users WHERE id = 1', 'readonly')).toThrow(
      SqlPolicyError,
    );
    expect(() => enforceSqlPolicy('MERGE INTO target USING source ON 1=1 WHEN MATCHED THEN DELETE;', 'readonly')).toThrow(
      SqlPolicyError,
    );
  });

  it('allows DML and safe DDL in write mode', () => {
    expect(enforceSqlPolicy('UPDATE users SET enabled = 1', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('INSERT INTO users (name) VALUES (@p1)', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('DELETE FROM sessions WHERE expired = 1', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('CREATE TABLE audit_log (id INT PRIMARY KEY)', 'write').kind).toBe('ddl');
    expect(enforceSqlPolicy('ALTER TABLE audit_log ADD created_at DATETIME2', 'write').kind).toBe('ddl');
  });

  it('rejects destructive DDL (DROP and TRUNCATE) in write mode', () => {
    expect(() => enforceSqlPolicy('DROP TABLE users', 'write')).toThrow('admin');
    expect(() => enforceSqlPolicy('TRUNCATE TABLE logs', 'write')).toThrow('admin');
    expect(enforceSqlPolicy('DROP TABLE users', 'admin').kind).toBe('admin');
    expect(enforceSqlPolicy('TRUNCATE TABLE logs', 'admin').kind).toBe('admin');
  });

  it('rejects EXEC/EXECUTE in readonly and write modes', () => {
    expect(() => enforceSqlPolicy('EXEC sp_help', 'readonly')).toThrow('admin');
    expect(() => enforceSqlPolicy("EXECUTE xp_cmdshell 'dir'", 'write')).toThrow('admin');
    expect(enforceSqlPolicy('EXEC sp_help', 'admin').kind).toBe('admin');
  });

  it('allows CTE (WITH) queries in readonly and write modes appropriately', () => {
    expect(
      enforceSqlPolicy(
        'WITH cte AS (SELECT id FROM users) SELECT * FROM cte',
        'readonly',
      ).kind,
    ).toBe('read');

    expect(
      enforceSqlPolicy(
        'WITH cte AS (SELECT id FROM users) UPDATE profiles SET active = 1 WHERE id IN (SELECT id FROM cte)',
        'write',
      ).kind,
    ).toBe('dml');
  });

  it('rejects stacked statements in every mode', () => {
    expect(() => enforceSqlPolicy('SELECT 1; DELETE FROM users', 'admin')).toThrow(
      'Multiple SQL statements',
    );
    expect(() => enforceSqlPolicy('SELECT 1;;', 'admin')).toThrow('Multiple SQL statements');
  });
});
