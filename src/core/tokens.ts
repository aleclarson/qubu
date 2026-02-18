import { UnionToIntersection } from 'type-fest'
import { SQL } from '../core.ts'
import { getTableRef, Table } from '../definition/table.ts'
import { compareDelimiters, Delimiter } from './seq.ts'
import {
  IdentName,
  IdentNamespace,
  PgIdent,
  PgParam,
  PgSequence,
  PgSyntax,
  PgType,
  SequenceDelimiter,
  SQLAlias,
} from './symbols.ts'

/**
 * An escape hatch for raw SQL.
 */
export const unsafe = <T extends string>(syntax: T): Token.Syntax<T> => ({
  [PgSyntax]: syntax,
})

/** Empty token. This gets omitted from the query when tokenized. */
export const empty = unsafe('')

/**
 * Create a map of `unsafe()` tokens.
 */
export const unsafeMap = <T extends string>(
  ...tokens: readonly T[]
): UnionToIntersection<
  T extends string ? { [K in T]: Token.Syntax<T> } : never
> =>
  tokens.reduce((acc, token) => {
    acc[token] = unsafe(token)
    return acc
  }, {} as any)

/**
 * Declare an identifier. Often refers to a column, table, or schema
 * name or alias.
 */
export function ident<Name extends string>(
  name: Name,
  namespace: Token.Identifier | null = null
): Token.Identifier<Name> {
  return {
    [PgIdent]: escapeIdentifier(name),
    [IdentName]: name,
    [IdentNamespace]: namespace,
  }
}

/**
 * Clone an identifier without its namespace.
 */
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
  export type Identifier<Name extends string = string> = {
    [PgIdent]: string
    /** The unescaped name of the identifier. */
    [IdentName]: Name
    [IdentNamespace]: Identifier | null
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

/**
 * A token returned from a `tokenize()` call.
 *
 * Notably, JS arrays are not flattened, but treated as a
 * parenthesized expression.
 */
export type Token = string | Token.Param | Token.Sequence | SQL.Query | Token[]

/**
 * Process an array of SQL parts into an array of tokens. A "token" is
 * either a string (raw SQL syntax), an escaped parameter, a token
 * sequence, a parenthesized expression (nested arrays), or a
 * `SQL.Query` object (a subquery).
 *
 * Notably, token sequences are flattened if their delimiter is the
 * same as the `delimiter` argument.
 */
export function tokenize(
  parts: readonly SQL.Part[],
  tokens: Token[] = [],
  delimiter: Delimiter = ' '
): Token[] {
  // The goal is to flatten as much as possible, in order to reduce
  // memory usage and to avoid nested structures for easier debugging.
  for (const part of parts) {
    tokenizePart(part, tokens, delimiter)
  }
  return tokens
}

/**
 * Like `tokenize()`, but for a single part.
 */
export function tokenizePart(
  part: SQL.Part,
  tokens: Token[] = [],
  delimiter: Delimiter = ' '
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
    if (isToken(part, PgSequence)) {
      // Dissolve the sequence if parent has same delimiter.
      if (compareDelimiters(part[SequenceDelimiter], delimiter)) {
        part[PgSequence].forEach(token => tokens.push(token))
        return tokens
      }
      token = part
    } else if (isToken(part, PgIdent)) {
      token = renderIdentifier(part)
    } else if (isToken(part, PgParam)) {
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
      token = renderIdentifier(getTableRef(part))
    }
  }
  if (!token) {
    throw new Error(`Invalid part: ${Object.prototype.toString.call(part)}`)
  }
  tokens.push(token)
  return tokens
}

/**
 * Tokenize a function call. This assumes a `""` (empty string)
 * delimiter between each returned token.
 */
export function tokenizeCall(name: string, ...args: SQL.Part[]): Token[] {
  const tokens = [name, '(']
  for (let i = 0; i < args.length; i++) {
    if (i > 0) tokens.push(', ')
    tokenizePart(args[i], tokens, '')
  }
  tokens.push(')')
  return tokens
}

export function renderIdentifier(id: Token.Identifier): string {
  return id[IdentNamespace]
    ? renderIdentifier(id[IdentNamespace]) + '.' + id[PgIdent]
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

export function renderTokens(tokens: Token[], params: unknown[]): string {
  let sql = ''
  for (const token of tokens) {
    const chunk = renderToken(token, params)
    if (!chunk) continue
    if (sql.length) sql += ' '
    sql += chunk
  }
  return sql
}

function renderToken(token: Token, params: unknown[]): string {
  if (typeof token === 'string') {
    return token
  }
  if (isToken(token, PgParam)) {
    const index = 1 + params.indexOf(token[PgParam])
    return '$' + (index || params.push(token[PgParam]))
  }
  if (isToken(token, PgSequence)) {
    let sequence = ''
    for (let i = 0; i < token[PgSequence].length; i++) {
      if (i > 0) sequence += token[SequenceDelimiter][PgSyntax]
      sequence += renderToken(token[PgSequence][i], params)
    }
    return sequence
  }
  if (token instanceof SQL.QueryIdentifier) {
    return token[SQLAlias][PgIdent] // Subquery reference
  }
  if (token instanceof SQL.Query) {
    return renderTokens(token[PgSequence], params)
  }
  return '(' + renderTokens(token, params) + ')'
}
