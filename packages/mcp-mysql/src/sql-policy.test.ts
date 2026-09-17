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
    expect(enforceSqlPolicy('INSERT INTO users (name) VALUES (?)', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('REPLACE INTO cache (key, val) VALUES (?, ?)', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('CREATE TABLE audit_log (id INT)', 'write').kind).toBe('ddl');
    expect(enforceSqlPolicy('ALTER TABLE audit_log ADD COLUMN created_at TIMESTAMP', 'write').kind).toBe('ddl');
  });

  it('rejects destructive DDL (DROP and TRUNCATE) in write mode', () => {
    expect(() => enforceSqlPolicy('DROP TABLE users', 'write')).toThrow('admin');
    expect(() => enforceSqlPolicy('DROP VIEW active_users', 'write')).toThrow('admin');
    expect(() => enforceSqlPolicy('TRUNCATE TABLE logs', 'write')).toThrow('admin');
    expect(enforceSqlPolicy('DROP TABLE users', 'admin').kind).toBe('admin');
    expect(enforceSqlPolicy('TRUNCATE TABLE logs', 'admin').kind).toBe('admin');
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
        'WITH RECURSIVE subordinates AS (SELECT 1) SELECT * FROM subordinates',
        'readonly',
      ).kind,
    ).toBe('read');

    expect(
      enforceSqlPolicy(
        'WITH cte AS (SELECT id FROM users) UPDATE profiles JOIN cte ON profiles.id = cte.id SET active = 1',
        'write',
      ).kind,
    ).toBe('dml');
  });

  it('distinguishes locking clauses from non-locking FOR keywords', () => {
    // SELECT ... FOR UPDATE should be recognized as transaction
    expect(enforceSqlPolicy('SELECT * FROM users FOR UPDATE', 'admin').kind).toBe('transaction');
    expect(() => enforceSqlPolicy('SELECT * FROM users FOR UPDATE', 'readonly')).toThrow(
      SqlPolicyError,
    );

    // SELECT ... LOCK IN SHARE MODE
    expect(enforceSqlPolicy('SELECT * FROM users LOCK IN SHARE MODE', 'admin').kind).toBe(
      'transaction',
    );

    // Non-locking usage of FOR (e.g. JSON_TABLE with FOR ORDINALITY) should remain read
    expect(
      enforceSqlPolicy(
        "SELECT * FROM JSON_TABLE('[]', '$[*]' COLUMNS (row_num FOR ORDINALITY)) AS jt",
        'readonly',
      ).kind,
    ).toBe('read');
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
