import { assert } from 'radashi'
import { boolean } from './data/boolean.ts'
import { Column } from './definition/column.ts'
import { Table } from './definition/table.ts'
import {
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
  SQLFields,
  SQLTokens,
} from './symbols.ts'
import {
  empty,
  ident,
  isToken,
  pgTokens,
  sequence,
  Token,
  tokenize,
  unsafe,
} from './tokens.ts'

/**
 * Declare a database type, with serialization and parsing functions.
 */
export function pgType<
  Id extends string,
  In,
  Out,
  DefaultNullable extends boolean = true,
>(
  id: Id,
  encode: (jsType: In) => any,
  decode: (sqlType: any) => Out,
  nullable = true as DefaultNullable
) {
  function type(name = '') {
    return new Column(name, type, nullable)
  }
  type[PgType] = id
  type.encode = encode
  type.decode = decode
  return type
}

const inOut = (arg: any) => arg

/**
 * Shortcut for encoding and decoding functions that don't do any
 * processing. Exists for type safety at compile time.
 */
export const $type = <T>() => inOut as (value: T) => T

function encode<T extends SQL.Type>(type: T, value: SQL.InferInput<T>) {
  return value == null ? null : type.encode(value)
}

/**
 * Declare an array variant of a given data type.
 */
export function array<Id extends string, In, Out>(
  type: SQL.Type<Id, In, Out>
): SQL.Type<`${Id}[]`, In[], Out[]> {
  return pgType(
    `${type[PgType]}[]`,
    (data: In[]) => data.map(encode.bind(null, type)),
    (data: any[]) => data.map(type.decode)
  )
}

export class SQL<Out = any> {
  protected [SQLTokens]: Token[] = []
  protected [SQLDecoder]: SQL.Decoder<Out> | null = null
  protected [SQLFields]: Record<string, SQL.Decoder<Out>> | null = null
  protected [SQLAlias]: SQL.Identifier | null = null

  /**
   * Set the alias for this SQL object.
   * @returns The same SQL object.
   */
  as(alias: string) {
    this[SQLAlias] = ident(alias)
    return this
  }

  /**
   * Set the data type of the SQL object, controlling how the result
   * is parsed.
   * @returns The same SQL object.
   */
  mapWith<T extends SQL.Type>(dataType: T | null): SQL<SQL.InferOutput<T>>
  mapWith<T>(decoder: ((sqlType: unknown) => T) | null): SQL<T>
  mapWith(dataType: SQL.Type | ((sqlType: unknown) => unknown) | null) {
    this[SQLDecoder] =
      dataType && typeof dataType !== 'function' ? dataType.decode : dataType
    return this
  }

  /**
   * Generate the SQL string and parameter values for this SQL object.
   */
  toQuery() {
    const params: unknown[] = []
    return {
      sql: renderQuery(this[SQLTokens], params),
      params,
    }
  }

  /**
   * Compare the SQL object to a given value.
   */
  is(operator: BinaryOperator, value: SQL.Part) {
    assert(binaryOperators[operator], 'Invalid binary operator')
    return sql(this, unsafe(operator), value).mapWith(boolean)
  }

  /**
   * Check if the SQL object evaluates to `null`.
   *
   * **Note:** This always returns `false` for JSON null (e.g.
   * `JSON.stringify(null)`).
   */
  isNull() {
    return sql(this, unsafe('is null')).mapWith(boolean)
  }

  /**
   * Check if the SQL object evaluates to `not null`.
   */
  isNotNull() {
    return sql(this, unsafe('is not null')).mapWith(boolean)
  }

  /**
   * Ascending sort order. Append an `asc` modifier to the SQL object.
   */
  asc(options?: {
    /**
     * Rows where the preceding expression is `null` should come first.
     * @default false
     */
    nullsFirst?: boolean
    /**
     * Change the sort order to descending.
     * @default false
     */
    reverse?: boolean
  }) {
    return sql(
      this,
      unsafe(options?.reverse ? 'desc' : 'asc'),
      options?.nullsFirst ? unsafe('nulls first') : undefined
    )
  }

  /**
   * Descending sort order. Append a `desc` modifier to the SQL object.
   */
  desc(options?: {
    /**
     * Rows where the preceding expression is `null` should come last.
     * @default false
     */
    nullsLast?: boolean
    /**
     * Change the sort order to ascending.
     * @default false
     */
    reverse?: boolean
  }) {
    return sql(
      this,
      unsafe(options?.reverse ? 'asc' : 'desc'),
      options?.nullsLast ? unsafe('nulls last') : undefined
    )
  }

  /**
   * Cast a value to a given type.
   */
  cast<T>(type: SQL.Type<string, any, T>) {
    return sql(sequence([this, unsafe('::'), type], empty)).mapWith(type)
  }
}

// prettier-ignore
const binaryOperators = {
  "=": 1, "!=": 1, ">": 1, ">=": 1, "<": 1, "<=": 1, "in": 1, "not in": 1,
  "like": 1, "not like": 1, "ilike": 1, "not ilike": 1, "between": 1,
  "not between": 1
} as const

export type BinaryOperator = keyof typeof binaryOperators

/** The `and` operator. */
export const and = (...parts: SQL.Part[]) =>
  sql(unsafe('and'), ...parts).mapWith(boolean)

/** The `or` operator. */
export const or = (...parts: SQL.Part[]) =>
  sql(unsafe('or'), ...parts).mapWith(boolean)

/** The `not` operator. */
export const not = (...parts: SQL.Part[]) =>
  sql(unsafe('not'), ...parts).mapWith(boolean)

export declare namespace SQL {
  export type Primitive =
    | string
    | number
    | bigint
    | boolean
    | Date
    | null
    | undefined

  export type Part = pgTokens[keyof pgTokens] | SQL | Table | Primitive | Part[]

  /**
   * An escaped string.
   */
  export type Param = { [PgParam]: string | unknown[] }

  /**
   * An escape hatch for raw SQL.
   */
  export type Syntax = { [PgSyntax]: string }

  /**
   * A clause is a syntactic component of a statement, usually
   * introduced by a keyword like `SELECT`, `WHERE`, `FROM`, or `ORDER
   * BY`, that specifies a particular action or operation in the
   * query.
   */
  export type Clause = { [PgClause]: string; parts: SQL.Part[] }

  /**
   * A sequence of tokens, with a given separator between each item.
   */
  export type Sequence = { [PgSequence]: Token[]; separator: SQL.Syntax }

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

  export type Encoder<In = unknown> = (jsType: In) => unknown
  export type Decoder<Out = unknown> = (sqlType: unknown) => Out

  /**
   * A data type in PostgreSQL, with encoding and decoding functions.
   */
  export type Type<Id extends string = string, In = any, Out = any> = {
    [PgType]: Id
    encode: Encoder<In>
    decode: Decoder<Out>
  }

  /**
   * Infer the input type of a given data type.
   */
  export type InferInput<T extends Type> =
    T extends Type<any, infer TInput> ? TInput : never

  /**
   * Infer the output type of a given data type.
   */
  export type InferOutput<T extends Type | SQL | ColumnIdentifier> =
    T extends Type<any, any, infer TOutput>
      ? TOutput
      : T extends SQL<infer TOutput>
        ? TOutput
        : T extends ColumnIdentifier<Column<any, infer TColumnOutput>>
          ? TColumnOutput
          : unknown
}

/**
 * Concatenate chunks of SQL. If later nested in a `SQL.Sequence`, the
 * chunks will be joined with that sequence's separator. Otherwise,
 * they're joined with a space.
 *
 * SQL instances are flattened (e.g. `sql(a, sql(b, c))` is the same
 * as `sql(a, b, c)`).
 */
export function sql<T extends readonly SQL.Part[]>(...parts: T) {
  return fromArray(parts)
}

function fromArray(parts: readonly SQL.Part[]) {
  const root = new SQL()
  root[SQLTokens] = tokenize(parts, root)
  return root
}

sql.fromArray = fromArray
sql.unsafe = unsafe
sql.sequence = sequence
sql.ident = ident

/**
 * You can use this or `sql(null)` to store a SQL null value in a
 * `json` or `jsonb` column.
 */
sql.null = () => sql(null) as SQL<null>

/**
 * Coerce a JavaScript array to an escaped SQL array.
 */
sql.arrayLiteral = (data: unknown[]) => ({ [PgParam]: data })

/**
 * Coerce a JavaScript value to an escaped SQL value.
 */
sql.literal = (data: any) => {
  if (typeof data === 'string' || Array.isArray(data)) {
    return { [PgParam]: data }
  }
  if (data !== null && typeof data === 'object') {
    if (
      typeof data.toJSON !== 'function' &&
      Object.prototype.toString.call(data.toJSON) !== '[object Object]'
    ) {
      throw new Error('sql.literal: toJSON is not a function')
    }
    return { [PgParam]: JSON.stringify(data) }
  }
  return data
}

export function renderQuery(tokens: Token[], params: unknown[]): string {
  let sql = ''
  for (const token of tokens) {
    sql += render(token, params)
  }
  return sql
}

function render(token: Token, params: unknown[]): string {
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
      if (i > 0) sequence += token.separator[PgSyntax]
      sequence += render(token[PgSequence][i], params)
    }
    return sequence
  }
  return '(' + renderQuery(token, params) + ')'
}
