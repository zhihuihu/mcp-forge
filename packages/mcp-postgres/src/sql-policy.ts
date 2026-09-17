import type { PostgresMode, SqlClassification, SqlStatementKind } from './types.js';

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
  return character !== undefined && !/[\s(),;/'"`$]/.test(character);
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

    // Line comment: --
    if (character === '-' && next === '-') {
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') {
        index += 1;
      }
      continue;
    }

    // Block comment: /* ... */ (PostgreSQL supports nested block comments)
    if (character === '/' && next === '*') {
      index += 2;
      let depth = 1;
      while (index < sql.length && depth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1;
          index += 2;
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth > 0) {
        throw new SqlPolicyError('SQL contains an unterminated block comment.');
      }
      continue;
    }

    // Dollar-quoted strings: $$...$$ or $tag$...$tag$
    if (character === '$') {
      const tagMatch = sql.slice(index).match(/^\$([a-zA-Z0-9_]*)\$/);
      if (tagMatch && tagMatch[0]) {
        const fullTag = tagMatch[0];
        const endTagIndex = sql.indexOf(fullTag, index + fullTag.length);
        if (endTagIndex === -1) {
          throw new SqlPolicyError('SQL contains an unterminated dollar-quoted string.');
        }
        tokens.push({ kind: 'string', value: '<quoted>' });
        index = endTagIndex + fullTag.length;
        continue;
      }
    }

    // Single quotes, double quotes
    if (character === "'" || character === '"') {
      const quote = character;
      index += 1;
      while (index < sql.length) {
        const current = sql[index];
        const following = sql[index + 1];
        if (current === quote) {
          if (following === quote) {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      if (sql[index - 1] !== quote) {
        throw new SqlPolicyError('SQL contains an unterminated quoted value or identifier.');
      }
      tokens.push({ kind: quote === '"' ? 'word' : 'string', value: '<quoted>' });
      continue;
    }

    // Symbols: ; ( ) ,
    if (character === ';' || character === '(' || character === ')' || character === ',') {
      tokens.push({ kind: 'symbol', value: character });
      index += 1;
      continue;
    }

    // Word tokens
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

function hasLockingClause(tokenWords: readonly string[]): boolean {
  for (let i = 0; i < tokenWords.length - 1; i++) {
    if (tokenWords[i] === 'FOR') {
      const nextWord = tokenWords[i + 1];
      if (nextWord === 'UPDATE' || nextWord === 'SHARE') {
        return true;
      }
      if (
        (nextWord === 'NO' || nextWord === 'KEY') &&
        i + 2 < tokenWords.length
      ) {
        return true;
      }
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
      if (upper === 'AS' || upper === 'RECURSIVE') {
        continue;
      }
      if (tokens[i - 1]?.value === ',') {
        // Next CTE alias
        continue;
      }
      if (['SELECT', 'TABLE', 'VALUES', 'INSERT', 'UPDATE', 'DELETE'].includes(upper)) {
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

  // Dangerous file system and copy statements
  if (
    containsAny(valueWords, [
      'COPY',
      'PG_READ_FILE',
      'PG_WRITE_FILE',
      'PG_READ_BINARY_FILE',
      'DBLINK',
    ])
  ) {
    return { kind: 'admin', firstKeyword: value };
  }

  // CTE (Common Table Expression) support: WITH ... AS (...) SELECT ...
  if (value === 'WITH') {
    const mainKeyword = findMainStatementKeywordInWith(tokens);
    if (mainKeyword === 'SELECT' || mainKeyword === 'TABLE' || mainKeyword === 'VALUES') {
      if (hasLockingClause(valueWords)) {
        return { kind: 'transaction', firstKeyword: value };
      }
      return { kind: 'read', firstKeyword: value };
    }
    if (mainKeyword && ['INSERT', 'UPDATE', 'DELETE'].includes(mainKeyword)) {
      return { kind: 'dml', firstKeyword: value };
    }
    return { kind: 'unknown', firstKeyword: value };
  }

  // Read-only queries
  if (
    value === 'SELECT' ||
    value === 'TABLE' ||
    value === 'VALUES' ||
    value === 'EXPLAIN' ||
    value === 'SHOW'
  ) {
    if (value === 'SELECT' && hasLockingClause(valueWords)) {
      return { kind: 'transaction', firstKeyword: value };
    }
    // In PostgreSQL, EXPLAIN ANALYZE actually executes the statement!
    if (
      value === 'EXPLAIN' &&
      valueWords.includes('ANALYZE') &&
      containsAny(valueWords, ['INSERT', 'UPDATE', 'DELETE'])
    ) {
      return { kind: 'dml', firstKeyword: value };
    }
    return { kind: 'read', firstKeyword: value };
  }

  // DML
  if (value === 'INSERT' || value === 'UPDATE' || value === 'DELETE') {
    return { kind: 'dml', firstKeyword: value };
  }

  // DROP and TRUNCATE are strictly restricted to admin mode
  if (value === 'DROP' || value === 'TRUNCATE') {
    return { kind: 'admin', firstKeyword: value };
  }

  // Safe DDL
  if (value === 'CREATE' || value === 'ALTER') {
    const administrativeObject = [
      'USER',
      'ROLE',
      'DATABASE',
      'TABLESPACE',
      'SUBSCRIPTION',
      'PUBLICATION',
      'SERVER',
    ];
    const second = valueWords[1];
    return {
      kind: administrativeObject.includes(second ?? '') ? 'admin' : 'ddl',
      firstKeyword: value,
    };
  }

  if (value === 'RENAME') {
    return { kind: 'ddl', firstKeyword: value };
  }

  // Administrative statements
  if (
    containsAny(
      [value],
      [
        'GRANT',
        'REVOKE',
        'VACUUM',
        'REINDEX',
        'CLUSTER',
        'DISCARD',
        'RESET',
        'SET',
        'DO',
        'CALL',
        'LOCK',
      ],
    )
  ) {
    return { kind: 'admin', firstKeyword: value };
  }

  // Transaction control
  if (
    containsAny(
      [value],
      ['BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'END'],
    )
  ) {
    return { kind: 'transaction', firstKeyword: value };
  }

  return { kind: 'unknown', firstKeyword: value };
}

export function classifySql(sql: string): SqlClassification {
  const statement = sql.trim();
  if (!statement) {
    throw new SqlPolicyError('SQL must not be empty.');
  }

  const tokens = tokenize(statement);
  const semicolonIndexes = tokens
    .map((token, index) => (token.value === ';' ? index : -1))
    .filter((index) => index >= 0);

  if (semicolonIndexes.length > 1) {
    throw new SqlPolicyError('Multiple SQL statements are not allowed.');
  }
  if (semicolonIndexes.length === 1 && semicolonIndexes[0] !== tokens.length - 1) {
    throw new SqlPolicyError('Multiple SQL statements are not allowed.');
  }

  const { kind, firstKeyword } = classify(tokens);
  return { kind, statement, firstKeyword };
}

export function enforceSqlPolicy(sql: string, mode: PostgresMode): SqlClassification {
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
