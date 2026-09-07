import type { MysqlMode, SqlClassification, SqlStatementKind } from './types.js';

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
  return character !== undefined && !/[\s(),;/'"`]/.test(character);
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

    if (character === '-' && next === '-' && isWhitespace(sql[index + 2])) {
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') {
        index += 1;
      }
      continue;
    }

    if (character === '#') {
      index += 1;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') {
        index += 1;
      }
      continue;
    }

    if (character === '/' && next === '*') {
      if (sql[index + 2] === '!' || sql[index + 2] === '+') {
        throw new SqlPolicyError('MySQL optimizer and versioned comments are not allowed.');
      }
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

    if (character === "'" || character === '"' || character === '`') {
      const quote = character;
      index += 1;
      while (index < sql.length) {
        const current = sql[index];
        const following = sql[index + 1];
        if (current === '\\') {
          index += 2;
          continue;
        }
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
      tokens.push({ kind: quote === '`' ? 'word' : 'string', value: '<quoted>' });
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

function classify(tokens: readonly SqlToken[]): { kind: SqlStatementKind; firstKeyword: string } {
  const value = tokens.find((token) => token.kind === 'word')?.value.toUpperCase();
  if (!value) {
    throw new SqlPolicyError('SQL must contain a statement.');
  }

  const valueWords = words(tokens);
  const next = secondWord(valueWords);

  if (containsAny(valueWords, ['INTO', 'OUTFILE', 'DUMPFILE', 'LOAD_FILE'])) {
    return { kind: 'admin', firstKeyword: value };
  }

  if (
    value === 'SELECT' ||
    value === 'SHOW' ||
    value === 'DESCRIBE' ||
    value === 'DESC' ||
    value === 'EXPLAIN'
  ) {
    if (containsAny(valueWords, ['FOR', 'UPDATE']) && value === 'SELECT') {
      return { kind: 'transaction', firstKeyword: value };
    }
    return { kind: 'read', firstKeyword: value };
  }

  if (value === 'INSERT' || value === 'UPDATE' || value === 'DELETE' || value === 'REPLACE') {
    return { kind: 'dml', firstKeyword: value };
  }

  if (value === 'CREATE' || value === 'ALTER' || value === 'DROP') {
    const administrativeObject = [
      'USER',
      'ROLE',
      'DATABASE',
      'SCHEMA',
      'PROCEDURE',
      'FUNCTION',
      'TRIGGER',
      'EVENT',
      'SERVER',
      'TABLESPACE',
      'LOGFILE',
      'RESOURCE',
    ];
    return {
      kind: administrativeObject.includes(next ?? '') ? 'admin' : 'ddl',
      firstKeyword: value,
    };
  }

  if (value === 'TRUNCATE' || value === 'RENAME') {
    return { kind: 'ddl', firstKeyword: value };
  }

  if (
    containsAny(
      [value],
      [
        'GRANT',
        'REVOKE',
        'SET',
        'FLUSH',
        'RESET',
        'KILL',
        'SHUTDOWN',
        'USE',
        'CALL',
        'INSTALL',
        'UNINSTALL',
      ],
    )
  ) {
    return { kind: 'admin', firstKeyword: value };
  }

  if (
    containsAny([value], ['BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'LOCK', 'UNLOCK'])
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

export function enforceSqlPolicy(sql: string, mode: MysqlMode): SqlClassification {
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
