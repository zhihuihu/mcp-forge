import { describe, expect, it } from 'vitest';

import { enforceSqlPolicy, SqlPolicyError } from './sql-policy.js';

describe('Kingbase SQL policy', () => {
  it('allows read statements in readonly mode', () => {
    expect(enforceSqlPolicy("SELECT 'DROP TABLE users' AS example;", 'readonly')).toMatchObject({
      kind: 'read',
      firstKeyword: 'SELECT',
    });
    expect(enforceSqlPolicy('EXPLAIN SELECT * FROM users', 'readonly').kind).toBe('read');
    expect(enforceSqlPolicy('SHOW search_path', 'readonly').kind).toBe('read');
    expect(enforceSqlPolicy('TABLE users', 'readonly').kind).toBe('read');
    expect(enforceSqlPolicy('DESC users', 'readonly').kind).toBe('read');
    expect(enforceSqlPolicy('DESCRIBE users', 'readonly').kind).toBe('read');
  });

  it('rejects DML in readonly mode', () => {
    expect(() => enforceSqlPolicy('UPDATE users SET enabled = true', 'readonly')).toThrow(
      SqlPolicyError,
    );
    expect(() => enforceSqlPolicy('REPLACE INTO users (id, name) VALUES (1, "a")', 'readonly')).toThrow(
      SqlPolicyError,
    );
    expect(() => enforceSqlPolicy('MERGE INTO target USING source ON (a=b) WHEN MATCHED THEN UPDATE SET a=1', 'readonly')).toThrow(
      SqlPolicyError,
    );
    // EXPLAIN ANALYZE with DML actually executes modification, must be rejected in readonly
    expect(() =>
      enforceSqlPolicy('EXPLAIN ANALYZE DELETE FROM users WHERE id = 1', 'readonly'),
    ).toThrow(SqlPolicyError);
    expect(
      enforceSqlPolicy('EXPLAIN ANALYZE DELETE FROM users WHERE id = 1', 'write').kind,
    ).toBe('dml');
  });

  it('allows DML and safe DDL in write mode', () => {
    expect(enforceSqlPolicy('UPDATE users SET enabled = true', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('INSERT INTO users (name) VALUES ($1)', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('DELETE FROM sessions WHERE expired = true', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('REPLACE INTO users (id, name) VALUES (1, "a")', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('MERGE INTO target USING source ON (a=b) WHEN MATCHED THEN UPDATE SET a=1', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('CREATE TABLE audit_log (id SERIAL PRIMARY KEY)', 'write').kind).toBe(
      'ddl',
    );
    expect(enforceSqlPolicy('ALTER TABLE audit_log ADD COLUMN created_at TIMESTAMPTZ', 'write').kind).toBe(
      'ddl',
    );
  });

  it('rejects destructive DDL (DROP and TRUNCATE) in write mode', () => {
    expect(() => enforceSqlPolicy('DROP TABLE users', 'write')).toThrow('admin');
    expect(() => enforceSqlPolicy('DROP SCHEMA public', 'write')).toThrow('admin');
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
        'WITH cte AS (SELECT id FROM users) UPDATE profiles SET active = true WHERE id IN (SELECT id FROM cte)',
        'write',
      ).kind,
    ).toBe('dml');
  });

  it('distinguishes locking clauses from non-locking FOR keywords', () => {
    expect(enforceSqlPolicy('SELECT * FROM users FOR UPDATE', 'admin').kind).toBe('transaction');
    expect(() => enforceSqlPolicy('SELECT * FROM users FOR UPDATE', 'readonly')).toThrow(
      SqlPolicyError,
    );
    expect(enforceSqlPolicy('SELECT * FROM users FOR SHARE', 'admin').kind).toBe('transaction');
  });

  it('supports dollar-quoted strings, backticks, and comments', () => {
    expect(
      enforceSqlPolicy(
        'SELECT $tag$ DROP TABLE users; $tag$ AS sample',
        'readonly',
      ).kind,
    ).toBe('read');

    // MySQL style backtick identifier
    expect(
      enforceSqlPolicy(
        'SELECT `column_name` FROM `my_table`',
        'readonly',
      ).kind,
    ).toBe('read');

    // MySQL style hash comment
    expect(
      enforceSqlPolicy(
        '# This is a comment\nSELECT * FROM users',
        'readonly',
      ).kind,
    ).toBe('read');

    // Standard double-quoted identifier
    expect(
      enforceSqlPolicy(
        'SELECT "userName" FROM "Users"',
        'readonly',
      ).kind,
    ).toBe('read');
  });

  it('rejects stacked statements in every mode', () => {
    expect(() => enforceSqlPolicy('SELECT 1; DELETE FROM users', 'admin')).toThrow(
      'Multiple SQL statements',
    );
    expect(() => enforceSqlPolicy('SELECT 1;;', 'admin')).toThrow('Multiple SQL statements');
  });
});
