import { assert } from 'radashi'
import { sql, SQL } from './core.ts'
import { Column } from './definition/column.ts'
import { Table, tableRef } from './definition/table.ts'
import {
  ColumnName,
  ColumnType,
  IdentColumn,
  IdentName,
  IdentNamespace,
  PgIdent,
  PgParam,
  PgSequence,
  PgSyntax,
  PgType,
  SequenceDelimiter,
  SQLAlias,
  SQLDecoder,
} from './symbols.ts'

/**
 * An escape hatch for raw SQL.
 */
export const unsafe = <T extends string>(syntax: T): Token.Syntax<T> => ({
  [PgSyntax]: syntax,
})

/** Empty token. This gets omitted from the query when tokenized. */
export const empty = unsafe('')
/** Whitespace token */
export const space = unsafe(' ')
/** Comma token */
export const comma = unsafe(', ')
/** Dot token */
export const dot = unsafe('.')

/**
 * Declare an identifier. Often refers to a column, table, or schema
 * name or alias.
 */
export function ident(id: string): Token.Identifier
export function ident<TColumn extends Column>(
  id: string,
  column: TColumn
): Token.ColumnIdentifier<TColumn>

/** @internal */
export function ident(
  name: string,
  column: Column | null = null
): Token.Identifier {
  return {
    [PgIdent]: escapeIdentifier(name),
    [IdentName]: name,
    [IdentNamespace]: null,
    [IdentColumn]: column,
  }
}

/**
 * A sequence is a syntax unit made up of a list of tokens, with a
 * given separator between each item. If no separator is provided, the
 * tokens are joined with a space.
 */
export function sequence(
  parts: readonly SQL.Part[],
  delimiter: Token.Syntax = space
) {
  const tokens = tokenize(parts)
  if (tokens.length === 1) {
    return tokens[0]
  }
  return {
    [PgSequence]: tokenize(parts),
    [SequenceDelimiter]: delimiter,
  } satisfies Token.Sequence
}

/**
 * Alias a SQL part. If the alias already matches the part's identity
 * (e.g. column name or pre-existing alias), the part is returned as
 * is.
 *
 * Optionally, pass a `fields` object and any decoder associated with
 * the part will be added.
 */
export function withAlias(
  part: SQL.Part,
  alias: string,
  fields?: Record<string, SQL.Decoder>
) {
  if (part !== null && typeof part === 'object') {
    if (part instanceof SQL) {
      if (fields && SQL.isExpression(part) && part[SQLDecoder]) {
        assert(fields[alias] == null, `Alias appears twice: ${alias}`)
        fields[alias] = part[SQLDecoder]
      }
      if (SQL.isExpression(part) && alias === part[SQLAlias]?.[IdentName]) {
        return part
      }
    } else if (isColumnIdentifier(part)) {
      if (fields) {
        assert(fields[alias] == null, `Alias appears twice: ${alias}`)
        fields[alias] = part[IdentColumn][ColumnType].decode
      }
      if (alias === part[IdentColumn][ColumnName]) {
        return part
      }
    }
  }
  // No decoder found, so we'll just return the value as is.
  return sql(part).as(alias)
}

export function withoutNamespace(id: Token.Identifier): Token.Identifier {
  return { ...id, [IdentNamespace]: null }
}

export namespace Token {
  /**
   * An escaped string or JS array.
   */
  export type Param = { [PgParam]: string | unknown[] }

  /**
   * An escape hatch for raw SQL.
   */
  export type Syntax<T extends string = string> = { [PgSyntax]: T }

  /**
   * A sequence of tokens, with a given separator between each item.
   */
  export type Sequence = {
    [PgSequence]: Token[]
    [SequenceDelimiter]: Token.Syntax
  }

  /**
   * An identifier, safe from SQL injection. Often refers to a column or
   * table name.
   */
  export type Identifier = {
    [PgIdent]: string
    /** The unescaped name of the identifier. */
    [IdentName]: string
    [IdentNamespace]: Identifier | null
    [IdentColumn]: Column | null
  }

  export type ColumnIdentifier<TColumn extends Column = Column> = Identifier & {
    [IdentColumn]: TColumn
  }
}

export interface pgTokens {
  [PgIdent]: Token.Identifier
  [PgParam]: Token.Param
  [PgSequence]: Token.Sequence
  [PgSyntax]: Token.Syntax
}

const pgTokens: (keyof pgTokens)[] = [PgIdent, PgParam, PgSequence, PgSyntax]

/**
 * Type guard for database tokens.
 */
export function isToken<T extends keyof pgTokens = keyof pgTokens>(
  value: object,
  type?: T
): value is pgTokens[T] {
  return type
    ? Object.prototype.hasOwnProperty.call(value, type)
    : pgTokens.some(token => Object.prototype.hasOwnProperty.call(value, token))
}

export function isColumnIdentifier(
  token: object
): token is Token.ColumnIdentifier {
  return isToken(token, PgIdent) && token[IdentColumn] !== null
}

/**
 * A token returned from a `tokenize()` call.
 *
 * Notably, JS arrays are not flattened, but treated as a
 * parenthesized expression.
 */
export type Token = string | Token.Param | Token.Sequence | SQL.Query | Token[]

/**
 * Simplify the array of tokens such that only raw SQL, escaped
 * values, identifiers, and parenthesized expressions are left over.
 *
 * ⚠︎ Arrays are wrapped in parentheses, not flattened.
 */
export function tokenize(
  parts: readonly SQL.Part[],
  tokens: Token[] = []
): Token[] {
  // The goal is to flatten as much as possible, in order to reduce
  // memory usage and to avoid nested structures for easier debugging.
  for (const part of parts) {
    tokenizePart(part, tokens)
  }
  return tokens
}

/**
 * Like `tokenize()`, but for a single part. If you pass a `root` SQL
 * object without a `tokens` array, the SQL object will be extended
 * with the new tokens. Otherwise, a new tokens array is created and
 * returned.
 */
export function tokenizePart(part: SQL.Part, tokens: Token[] = []) {
  let token: Token | undefined
  if (part == null) {
    token = 'null' // Treat undefined as null
  } else if (
    typeof part === 'boolean' ||
    typeof part === 'number' ||
    typeof part === 'bigint'
  ) {
    // Even if an attacker manages to overwrite the `toString`
    // method on a prototype or instance, this will always be safe.
    token = String(part)
  } else if (typeof part === 'string') {
    token = { [PgParam]: part }
  } else if (Array.isArray(part)) {
    token = tokenize(part) // parenthesized expression
  } else if (typeof part === 'object') {
    if (isToken(part, PgIdent)) {
      token = tokenizeIdentifier(part)
    } else if (isToken(part, PgParam) || isToken(part, PgSequence)) {
      token = part
    } else if (isToken(part, PgSyntax)) {
      if (part[PgSyntax] === '') {
        return tokens // no-op
      }
      token = part[PgSyntax] // Raw SQL
    } else if (SQL.isType(part)) {
      token = part[PgType] // Type name
    } else if (part instanceof Date) {
      token = { [PgParam]: part.toISOString() }
    } else if (part instanceof Table) {
      token = tokenizeIdentifier(tableRef(part))
    }
  }
  if (!token) {
    throw new Error(`Invalid part: ${Object.prototype.toString.call(part)}`)
  }
  tokens.push(token)
  return tokens
}

function tokenizeIdentifier(id: Token.Identifier): string {
  return id[IdentNamespace]
    ? tokenizeIdentifier(id[IdentNamespace]) + '.' + id[PgIdent]
    : id[PgIdent]
}

const safeIdentifierRegex = /^[a-z][a-z0-9_]*$/
const doubleQuoteRegex = /"/g

// List generated with `SELECT * FROM pg_get_keywords() WHERE catcode = 'R';`
// prettier-ignore
const reservedWords = new Set([
  'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as', 'asc', 'asymmetric',
  'both', 'case', 'cast', 'check', 'collate', 'column', 'constraint', 'create',
  'current_catalog', 'current_date', 'current_role', 'current_time', 'current_timestamp',
  'current_user', 'default', 'deferrable', 'desc', 'distinct', 'do', 'else', 'end',
  'except', 'false', 'fetch', 'for', 'foreign', 'from', 'grant', 'group', 'having',
  'in', 'initially', 'intersect', 'into', 'lateral', 'leading', 'limit', 'localtime',
  'localtimestamp', 'not', 'null', 'offset', 'on', 'only', 'or', 'order', 'placing',
  'primary', 'references', 'returning', 'select', 'session_user', 'some', 'symmetric',
  'system_user', 'table', 'then', 'to', 'trailing', 'true', 'union', 'unique', 'user',
  'using', 'variadic', 'when', 'where', 'window', 'with'
])

export function escapeIdentifier(name: string) {
  if (!safeIdentifierRegex.test(name)) {
    return '"' + name.replace(doubleQuoteRegex, '""') + '"'
  }
  if (reservedWords.has(name)) {
    return '"' + name + '"'
  }
  return name
}
