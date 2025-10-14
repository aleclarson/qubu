import { assert } from 'radashi'
import { InferSQL, SQL, SQLExpression } from './core.ts'
import { Column } from './definition/column.ts'
import { Table, tableRef } from './definition/table.ts'
import {
  ColumnName,
  ColumnType,
  IdentColumn,
  IdentName,
  IdentNamespace,
  PgClause,
  PgIdent,
  PgParam,
  PgSequence,
  PgSyntax,
  PgType,
  SQLAlias,
  SQLDecoder,
  SQLTokenize,
  SQLTokens,
} from './symbols.ts'

/**
 * An escape hatch for raw SQL.
 */
export const unsafe = <T extends string>(syntax: T): SQL.Syntax<T> => ({
  [PgSyntax]: syntax,
})

/**
 * Declare a SQL clause.
 */
export const clause = (keyword: string, ...parts: SQL.Part[]): SQL.Clause => ({
  [PgClause]: keyword,
  parts,
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
export function ident(id: string): SQL.Identifier
export function ident<TColumn extends Column>(
  id: string,
  column: TColumn
): SQL.ColumnIdentifier<TColumn>

/** @internal */
export function ident(
  name: string,
  column: Column | null = null
): SQL.Identifier {
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
export const sequence = (
  parts: readonly SQL.Part[],
  separator: SQL.Syntax = space
): SQL.Sequence => ({
  [PgSequence]: tokenize(parts),
  separator,
})

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
  if (part instanceof SQLExpression) {
    if (fields && part[SQLDecoder]) {
      assert(fields[alias] == null, `Alias appears twice: ${alias}`)
      fields[alias] = part[SQLDecoder]
    }
    if (alias === part[SQLAlias]) {
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
  // No decoder found, so we'll just return the value as is.
  return InferSQL(part).as(alias)
}

export function withoutNamespace(id: SQL.Identifier): SQL.Identifier {
  return { ...id, [IdentNamespace]: null }
}

export interface pgTokens {
  [PgType]: SQL.Type
  [PgIdent]: SQL.Identifier
  [PgParam]: SQL.Param
  [PgSequence]: SQL.Sequence
  [PgSyntax]: SQL.Syntax
  [PgClause]: SQL.Clause
}

const pgTokens: (keyof pgTokens)[] = [
  PgType,
  PgIdent,
  PgParam,
  PgSequence,
  PgSyntax,
  PgClause,
]

/**
 * Type guard for database tokens.
 */
export function isToken<T extends keyof pgTokens = keyof pgTokens>(
  value: unknown,
  type?: T
): value is pgTokens[T] {
  return typeof value === 'object' && value !== null && type
    ? Object.prototype.hasOwnProperty.call(value, type)
    : pgTokens.some(token => Object.prototype.hasOwnProperty.call(value, token))
}

export function isColumnIdentifier(
  token: unknown
): token is SQL.ColumnIdentifier {
  return isToken(token, PgIdent) && token[IdentColumn] !== null
}

/**
 * A token returned from a `tokenize()` call.
 *
 * Notably, JS arrays are not flattened, but treated as a
 * parenthesized expression.
 */
export type Token = string | SQL.Param | SQL.Sequence | Token[]

/**
 * Simplify the array of tokens such that only raw SQL, escaped
 * values, identifiers, and parenthesized expressions are left over.
 *
 * ⚠︎ Arrays are wrapped in parentheses, not flattened.
 */
export function tokenize(parts: readonly SQL.Part[], root?: SQL): Token[] {
  // The goal is to flatten as much as possible, in order to reduce
  // memory usage and to avoid nested structures for easier debugging.
  const tokens: Token[] = root?.[SQLTokens] ?? []
  for (const part of parts) {
    tokenizePart(part, root, tokens)
  }
  return tokens
}

/**
 * Like `tokenize()`, but for a single part. If you pass a `root` SQL
 * object without a `tokens` array, the SQL object will be extended
 * with the new tokens. Otherwise, a new tokens array is created and
 * returned.
 */
export function tokenizePart(
  part: SQL.Part,
  root: SQL | undefined,
  tokens: Token[] = root?.[SQLTokens] ?? []
) {
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
    if (part instanceof SQLExpression) {
      part[SQLTokenize](tokens, root)
      if (part[SQLAlias]) {
        tokens.push('as', escapeIdentifier(part[SQLAlias]))
      }
      return tokens
    }
    if (isToken(part, PgClause)) {
      tokens.push(part[PgClause])
      for (const token of tokenize(part.parts, root)) {
        tokens.push(token)
      }
      return tokens
    }
    if (isToken(part, PgIdent)) {
      token = tokenizeIdentifier(part)
    } else if (isToken(part, PgParam) || isToken(part, PgSequence)) {
      token = part
    } else if (isToken(part, PgType)) {
      token = part[PgType] // Type name
    } else if (isToken(part, PgSyntax)) {
      if (part[PgSyntax] === '') {
        return tokens
      }
      token = part[PgSyntax] // Raw SQL
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

function tokenizeIdentifier(id: SQL.Identifier): string {
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
