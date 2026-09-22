import type { OracleMode, SqlClassification, SqlStatementKind } from './types.js';

interface SqlToken {
  kind: 'word' | 'string' | 'symbol';
  value: string;
}

export class SqlPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlPolicyError';
  }
}

function isWhitespace(character: string | undefined): boolean {
  return character === undefined || /\s/.test(character);
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && !/[\s(),;/'":]/.test(character);
}

function tokenize(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;

  while (index < sql.length) {
    const character = sql[index];
    const next = sql[index + 1];

    if (isWhitespace(character)) {
      index += 1;
      continue;
    }

    // Line comments: -- comment
    if (character === '-' && next === '-') {
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') {
        index += 1;
      }
      continue;
    }

    // Block comments: /* ... */
    if (character === '/' && next === '*') {
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) {
        index += 1;
      }
      if (index >= sql.length) {
        throw new SqlPolicyError('SQL contains an unterminated block comment.');
      }
      index += 2;
      continue;
    }

    // Quoted identifier: "..." in Oracle
    if (character === '"') {
      index += 1;
      const start = index;
      while (index < sql.length) {
        if (sql[index] === '"') {
          if (sql[index + 1] === '"') {
            index += 2;
            continue;
          }
          break;
        }
        index += 1;
      }
      if (sql[index] !== '"') {
        throw new SqlPolicyError('SQL contains an unterminated quoted identifier.');
      }
      tokens.push({ kind: 'word', value: sql.slice(start, index) });
      index += 1;
      continue;
    }

    // String literal: '...'
    if (character === "'") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'") {
          if (sql[index + 1] === "'") {
            index += 2;
            continue;
          }
          break;
        }
        index += 1;
      }
      if (sql[index] !== "'") {
        throw new SqlPolicyError('SQL contains an unterminated quoted value.');
      }
      tokens.push({ kind: 'string', value: '<quoted>' });
      index += 1;
      continue;
    }

    if (character === ';' || character === '(' || character === ')' || character === ',') {
      tokens.push({ kind: 'symbol', value: character });
      index += 1;
      continue;
    }

    if (isWordCharacter(character)) {
      const start = index;
      while (isWordCharacter(sql[index])) {
        index += 1;
      }
      tokens.push({ kind: 'word', value: sql.slice(start, index) });
      continue;
    }

    if (character === undefined) {
      break;
    }
    tokens.push({ kind: 'symbol', value: character });
    index += 1;
  }

  return tokens;
}

function words(tokens: readonly SqlToken[]): string[] {
  return tokens.filter((token) => token.kind === 'word').map((token) => token.value.toUpperCase());
}

function containsAny(values: readonly string[], candidates: readonly string[]): boolean {
  return candidates.some((candidate) => values.includes(candidate));
}

function secondWord(values: readonly string[]): string | undefined {
  return values[1];
}

function hasLockingClause(tokenWords: readonly string[]): boolean {
  for (let i = 0; i < tokenWords.length - 1; i++) {
    if (tokenWords[i] === 'FOR' && tokenWords[i + 1] === 'UPDATE') {
      return true;
    }
  }
  return false;
}

function findMainStatementKeywordInWith(tokens: readonly SqlToken[]): string | undefined {
  let depth = 0;
  let seenParenthesis = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) {
      continue;
    }
    if (token.value === '(') {
      depth += 1;
      seenParenthesis = true;
      continue;
    }
    if (token.value === ')') {
      depth -= 1;
      continue;
    }

    if (depth === 0 && seenParenthesis && token.kind === 'word') {
      const upper = token.value.toUpperCase();
      if (upper === 'AS') {
        continue;
      }
      if (tokens[i - 1]?.value === ',') {
        // Next CTE alias
        continue;
      }
      if (['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(upper)) {
        return upper;
      }
    }
  }

  return undefined;
}

function classify(tokens: readonly SqlToken[]): { kind: SqlStatementKind; firstKeyword: string } {
  const value = tokens.find((token) => token.kind === 'word')?.value.toUpperCase();
  if (!value) {
    throw new SqlPolicyError('SQL must contain a statement.');
  }

  const valueWords = words(tokens);
  const next = secondWord(valueWords);

  // CTE support: WITH ... AS (...) SELECT ...
  if (value === 'WITH') {
    const mainKeyword = findMainStatementKeywordInWith(tokens);
    if (mainKeyword === 'SELECT') {
      if (hasLockingClause(valueWords)) {
        return { kind: 'transaction', firstKeyword: value };
      }
      return { kind: 'read', firstKeyword: value };
    }
    if (mainKeyword && ['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(mainKeyword)) {
      return { kind: 'dml', firstKeyword: value };
    }
    return { kind: 'unknown', firstKeyword: value };
  }

  if (value === 'SELECT') {
    if (hasLockingClause(valueWords)) {
      return { kind: 'transaction', firstKeyword: value };
    }
    return { kind: 'read', firstKeyword: value };
  }

  if (value === 'INSERT' || value === 'UPDATE' || value === 'DELETE' || value === 'MERGE') {
    return { kind: 'dml', firstKeyword: value };
  }

  // Destructive DDL
  if (value === 'DROP' || value === 'TRUNCATE' || value === 'PURGE' || value === 'FLASHBACK') {
    return { kind: 'admin', firstKeyword: value };
  }

  if (value === 'CREATE' || value === 'ALTER') {
    const administrativeObject = [
      'USER',
      'ROLE',
      'PROFILE',
      'TABLESPACE',
      'DATABASE',
      'DIRECTORY',
      'SYSTEM',
      'SESSION',
      'PROCEDURE',
      'FUNCTION',
      'PACKAGE',
      'TRIGGER',
      'TYPE',
      'CONTEXT',
    ];
    return {
      kind: administrativeObject.includes(next ?? '') ? 'admin' : 'ddl',
      firstKeyword: value,
    };
  }

  if (value === 'RENAME' || value === 'COMMENT') {
    return { kind: 'ddl', firstKeyword: value };
  }

  if (
    containsAny(
      [value],
      [
        'GRANT',
        'REVOKE',
        'AUDIT',
        'NOAUDIT',
        'ANALYZE',
        'CALL',
        'EXEC',
        'EXECUTE',
        'LOCK',
        'DISCONNECT',
        'SHUTDOWN',
        'STARTUP',
      ],
    )
  ) {
    return { kind: 'admin', firstKeyword: value };
  }

  if (containsAny([value], ['COMMIT', 'ROLLBACK', 'SAVEPOINT', 'SET'])) {
    return { kind: 'transaction', firstKeyword: value };
  }

  return { kind: 'unknown', firstKeyword: value };
}

export function classifySql(sql: string): SqlClassification {
  let statement = sql.trim();
  if (!statement) {
    throw new SqlPolicyError('SQL must not be empty.');
  }

  // Strip trailing semicolon if present (Oracle driver rejects statements ending with semicolon)
  if (statement.endsWith(';')) {
    statement = statement.slice(0, -1).trim();
  }

  const tokens = tokenize(statement);
  const semicolonIndexes = tokens
    .map((token, index) => (token.value === ';' ? index : -1))
    .filter((index) => index >= 0);

  if (semicolonIndexes.length > 0) {
    throw new SqlPolicyError('Multiple SQL statements are not allowed.');
  }

  const { kind, firstKeyword } = classify(tokens);
  return { kind, statement, firstKeyword };
}

export function enforceSqlPolicy(sql: string, mode: OracleMode): SqlClassification {
  const classification = classifySql(sql);

  if (mode === 'admin') {
    return classification;
  }

  const allowed =
    mode === 'readonly'
      ? classification.kind === 'read'
      : classification.kind === 'read' ||
        classification.kind === 'dml' ||
        classification.kind === 'ddl';

  if (!allowed) {
    const modeDescription = mode === 'readonly' ? 'readonly mode' : 'write mode';
    throw new SqlPolicyError(
      `${classification.firstKeyword} statements are not allowed in ${modeDescription}. Use --mode=admin for administrative SQL.`,
    );
  }

  return classification;
}
