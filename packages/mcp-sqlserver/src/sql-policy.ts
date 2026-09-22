import type { SqlClassification, SqlserverMode, SqlStatementKind } from './types.js';

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
  return character !== undefined && !/[\s(),;/'"`\[\]]/.test(character);
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

    // Block comments: /* ... */ with nested comment support (T-SQL standard)
    if (character === '/' && next === '*') {
      index += 2;
      let depth = 1;
      while (index < sql.length && depth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1;
          index += 2;
          continue;
        }
        if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1;
          index += 2;
          continue;
        }
        index += 1;
      }
      if (depth > 0) {
        throw new SqlPolicyError('SQL contains an unterminated block comment.');
      }
      continue;
    }

    // T-SQL bracketed identifier: [col_name]
    if (character === '[') {
      index += 1;
      const start = index;
      let bracketClosed = false;
      while (index < sql.length) {
        if (sql[index] === ']') {
          if (sql[index + 1] === ']') {
            index += 2;
            continue;
          }
          bracketClosed = true;
          break;
        }
        index += 1;
      }
      if (!bracketClosed) {
        throw new SqlPolicyError('SQL contains an unterminated bracketed identifier.');
      }
      tokens.push({ kind: 'word', value: sql.slice(start, index) });
      index += 1;
      continue;
    }

    // Quoted string or identifier: '...' or "..."
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
        // Next CTE alias name
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
      return { kind: 'read', firstKeyword: value };
    }
    if (mainKeyword && ['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(mainKeyword)) {
      return { kind: 'dml', firstKeyword: value };
    }
    return { kind: 'unknown', firstKeyword: value };
  }

  if (value === 'SELECT') {
    return { kind: 'read', firstKeyword: value };
  }

  if (value === 'INSERT' || value === 'UPDATE' || value === 'DELETE' || value === 'MERGE') {
    return { kind: 'dml', firstKeyword: value };
  }

  // DROP and TRUNCATE are destructive and strictly reserved for admin mode
  if (value === 'DROP' || value === 'TRUNCATE') {
    return { kind: 'admin', firstKeyword: value };
  }

  if (value === 'CREATE' || value === 'ALTER') {
    const administrativeObject = [
      'USER',
      'LOGIN',
      'ROLE',
      'DATABASE',
      'SCHEMA',
      'PROCEDURE',
      'FUNCTION',
      'TRIGGER',
      'SERVER',
      'ENDPOINT',
      'AVAILABILITY',
      'CERTIFICATE',
      'CREDENTIAL',
    ];
    return {
      kind: administrativeObject.includes(next ?? '') ? 'admin' : 'ddl',
      firstKeyword: value,
    };
  }

  if (
    containsAny(
      [value],
      [
        'GRANT',
        'REVOKE',
        'DENY',
        'SET',
        'KILL',
        'SHUTDOWN',
        'USE',
        'EXEC',
        'EXECUTE',
        'DBCC',
        'BACKUP',
        'RESTORE',
        'RECONFIGURE',
      ],
    )
  ) {
    return { kind: 'admin', firstKeyword: value };
  }

  if (containsAny([value], ['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVE'])) {
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

export function enforceSqlPolicy(sql: string, mode: SqlserverMode): SqlClassification {
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
