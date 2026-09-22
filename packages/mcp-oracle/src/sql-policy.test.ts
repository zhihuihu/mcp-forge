import { describe, expect, it } from 'vitest';

import { enforceSqlPolicy, SqlPolicyError } from './sql-policy.js';

describe('Oracle SQL policy', () => {
  it('allows read statements in readonly mode and strips trailing semicolon', () => {
    const res = enforceSqlPolicy("SELECT 'DROP TABLE users' AS example FROM dual;", 'readonly');
    expect(res).toMatchObject({
      kind: 'read',
      firstKeyword: 'SELECT',
    });
    expect(res.statement.endsWith(';')).toBe(false);

    expect(enforceSqlPolicy('SELECT * FROM "HR"."EMPLOYEES" WHERE ROWNUM <= 10', 'readonly').kind).toBe('read');
  });

  it('supports double-quoted identifiers in Oracle', () => {
    expect(enforceSqlPolicy('SELECT "SELECT", "FROM" FROM "Order Details"', 'readonly').kind).toBe('read');
  });

  it('rejects DML in readonly mode', () => {
    expect(() => enforceSqlPolicy('UPDATE users SET enabled = 1', 'readonly')).toThrow(
      SqlPolicyError,
    );
    expect(() => enforceSqlPolicy('DELETE FROM users WHERE id = 1', 'readonly')).toThrow(
      SqlPolicyError,
    );
    expect(() =>
      enforceSqlPolicy(
        'MERGE INTO bonuses d USING (SELECT employee_id FROM employees) s ON (d.employee_id = s.employee_id) WHEN MATCHED THEN UPDATE SET d.bonus = 100',
        'readonly',
      ),
    ).toThrow(SqlPolicyError);
  });

  it('allows DML and safe DDL in write mode', () => {
    expect(enforceSqlPolicy('UPDATE users SET enabled = 1', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('INSERT INTO users (name) VALUES (:1)', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('DELETE FROM sessions WHERE expired = 1', 'write').kind).toBe('dml');
    expect(enforceSqlPolicy('CREATE TABLE audit_log (id NUMBER PRIMARY KEY)', 'write').kind).toBe('ddl');
    expect(enforceSqlPolicy('ALTER TABLE audit_log ADD created_at TIMESTAMP', 'write').kind).toBe('ddl');
  });

  it('rejects destructive DDL (DROP and TRUNCATE) in write mode', () => {
    expect(() => enforceSqlPolicy('DROP TABLE users', 'write')).toThrow('admin');
    expect(() => enforceSqlPolicy('TRUNCATE TABLE logs', 'write')).toThrow('admin');
    expect(() => enforceSqlPolicy('PURGE RECYCLEBIN', 'write')).toThrow('admin');
    expect(enforceSqlPolicy('DROP TABLE users', 'admin').kind).toBe('admin');
    expect(enforceSqlPolicy('TRUNCATE TABLE logs', 'admin').kind).toBe('admin');
  });

  it('rejects administrative commands in readonly and write modes', () => {
    expect(() => enforceSqlPolicy('GRANT SELECT ON employees TO hr', 'write')).toThrow('admin');
    expect(() => enforceSqlPolicy('ALTER SYSTEM CHECKPOINT', 'write')).toThrow('admin');
    expect(() => enforceSqlPolicy('CREATE USER new_user IDENTIFIED BY pass', 'write')).toThrow('admin');
  });

  it('distinguishes FOR UPDATE locking queries', () => {
    expect(enforceSqlPolicy('SELECT * FROM employees FOR UPDATE', 'admin').kind).toBe('transaction');
    expect(() => enforceSqlPolicy('SELECT * FROM employees FOR UPDATE', 'readonly')).toThrow(
      SqlPolicyError,
    );
  });

  it('allows CTE (WITH) queries in readonly and write modes appropriately', () => {
    expect(
      enforceSqlPolicy(
        'WITH dept_count AS (SELECT dept_id, count(*) AS cnt FROM emp GROUP BY dept_id) SELECT * FROM dept_count',
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
  });
});
