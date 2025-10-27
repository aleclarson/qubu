import { assert } from 'radashi'
import { BinaryOperator, binaryOperators } from './binaryOperator.ts'
import { boolean } from './data/boolean.ts'
import { Column } from './definition/column.ts'
import {
  AliasedQueryWithColumns,
  getTableRef,
  Table,
} from './definition/table.ts'
import {
  ColumnName,
  ColumnTable,
  ColumnType,
  IdentName,
  PgColumn,
  PgExpression,
  PgIdent,
  PgParam,
  PgSequence,
  PgSyntax,
  PgTable,
  PgType,
  SequenceDelimiter,
  SQLAlias,
  SQLDecoder,
  SQLFields,
  SQLKeyword,
} from './symbols.ts'
import {
  empty,
  escapeIdentifier,
  ident,
  pgTokens,
  renderIdentifier,
  seq,
  space,
  Token,
  tokenize,
  unsafe,
} from './tokens.ts'
import { columnsProxy } from './util.ts'

export class SQL<Out = any> implements Token.Sequence {
  [PgSequence]: Token[];
  [SequenceDelimiter]: Token.Syntax

  constructor(sequence: Token[] = [], delimiter: Token.Syntax = space) {
    this[PgSequence] = sequence
    this[SequenceDelimiter] = delimiter
  }

  /**
   * Extend the SQL object by appending a new part. Any separator
   * other than `space` (the default) will be prefixed to each new
   * part.
   * @returns The same SQL object.
   */
  $append(
    parts: readonly SQL.Part[],
    separator: Token.Syntax = this[SequenceDelimiter]
  ) {
    if (separator[PgSyntax] === this[SequenceDelimiter][PgSyntax]) {
      tokenize(parts, this[PgSequence])
    } else {
      const { length } = this[PgSequence]

      const tokens = [this[PgSequence][length - 1]]
      tokenize(parts, tokens)

      this[PgSequence][length - 1] = {
        [PgSequence]: tokens,
        [SequenceDelimiter]: separator,
      } satisfies Token.Sequence
    }
    return this
  }
}

export namespace SQL {
  export function isType(value: object): value is SQL.Type {
    return Object.prototype.hasOwnProperty.call(value, PgType)
  }

  export function isExpression(value: object): value is SQL.Expression {
    return Object.prototype.hasOwnProperty.call(value, PgExpression)
  }

  export function isColumnReference(
    value: object
  ): value is SQL.ColumnReference {
    return Object.prototype.hasOwnProperty.call(value, PgColumn)
  }

  /**
   * SQL "expressions" always represent a value, but cannot be executed
   * directly. They rely on SQL statements to execute them.
   */
  export class Expression<
    Out = any,
    Alias extends string = string,
  > extends SQL<Out> {
    protected [PgExpression] = true as const
    protected [SQLAlias]: Token.Identifier<Alias> | null = null
    protected [SQLDecoder]: SQL.Decoder<Out> | null = null

    /**
     * Set the alias for this SQL object.
     * @returns The same SQL object.
     */
    as<Alias extends string>(alias: Alias): SQL.Expression<Out, Alias> {
      assert(this[SQLAlias] == null, 'Alias already set')
      this[SQLAlias] = ident(alias) as Token.Identifier<any>
      this[PgSequence].push('as', this[SQLAlias][PgIdent])
      return this as SQL.Expression<Out, any>
    }

    /**
     * Compare the SQL object to a given value.
     */
    is(operator: BinaryOperator, ...parts: SQL.Part[]) {
      assert(binaryOperators[operator], 'Invalid binary operator')
      return this.$append([unsafe(operator), ...parts]).mapWith(boolean)
    }

    /**
     * Check if the SQL object evaluates to `null`.
     *
     * **Note:** This always returns `false` for JSON null; e.g.
     * `JSON.stringify(null)`.
     */
    isNull() {
      return this.$append([unsafe('is null')]).mapWith(boolean)
    }

    /**
     * Check if the SQL object evaluates to `not null`.
     *
     * **Note:** This always returns `true` for JSON null; e.g.
     * `JSON.stringify(null)`.
     */
    isNotNull() {
      return this.$append([unsafe('is not null')]).mapWith(boolean)
    }

    /**
     * Append an `and` clause to the SQL object.
     * @returns The same SQL object.
     */
    and(...parts: SQL.Part[]) {
      return this.$append([unsafe('and'), ...parts]) as SQL.Expression<boolean>
    }

    /**
     * Append an `or` clause to the SQL object.
     * @returns The same SQL object.
     */
    or(...parts: SQL.Part[]) {
      return this.$append([unsafe('or'), ...parts]) as SQL.Expression<boolean>
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
       * Change the sort order to "descending" and flip the `nullsFirst`
       * option.
       * @default false
       */
      reverse?: boolean
    }) {
      return this.$append([
        unsafe(options?.reverse ? 'desc' : 'asc'),
        options?.nullsFirst
          ? unsafe(options?.reverse ? 'nulls last' : 'nulls first')
          : undefined,
      ]) as SQL<never>
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
       * Change the sort order to "ascending" and flip the `nullsLast`
       * option.
       * @default false
       */
      reverse?: boolean
    }) {
      return this.$append([
        unsafe(options?.reverse ? 'asc' : 'desc'),
        options?.nullsLast
          ? unsafe(options?.reverse ? 'nulls first' : 'nulls last')
          : undefined,
      ]) as SQL<never>
    }

    /**
     * Cast a value to a given type.
     */
    cast<T>(type: SQL.Type<string, any, T>) {
      return this.$append([unsafe('::'), type], empty).mapWith(type)
    }

    /**
     * Set the data type of the SQL object, controlling how the result
     * is parsed.
     * @returns The same SQL object.
     */
    mapWith<T extends SQL.Type>(
      dataType: T | null
    ): SQL.Expression<SQL.InferOutput<T>>
    mapWith<T>(decoder: ((sqlType: unknown) => T) | null): SQL.Expression<T>
    mapWith(dataType: SQL.Type | ((sqlType: unknown) => unknown) | null) {
      this[SQLDecoder] =
        dataType && typeof dataType !== 'function' ? dataType.decode : dataType
      return this
    }
  }

  /**
   * You get a `TableIdentifier` when you call `as()` on a `Table`.
   */
  export interface TableIdentifier<Out = any> extends Expression<Out> {
    [PgTable]: Table<any>
  }

  export class ColumnReference<
    Out = any,
    Name extends string = string,
  > extends Expression<Out, Name> {
    protected [PgColumn]: Column<any, Out> | null
    protected [ColumnName]: Name

    constructor(
      column: Column<any, Out> | null,
      id?: Token.Identifier<Name>,
      decoder?: SQL.Decoder<Out>
    ) {
      let name: string
      let escapedName: string
      if (id) {
        assert(!column, 'Cannot set both column and id')
        name = id[IdentName]
        escapedName = renderIdentifier(id)
      } else {
        assert(column, 'Must set either column or id')
        const table = column[ColumnTable]
        name = column[ColumnName]
        escapedName =
          renderIdentifier(getTableRef(table)) + '.' + escapeIdentifier(name)
      }
      super([escapedName])
      this[PgColumn] = column
      this[ColumnName] = name as Name
      this[SQLDecoder] = decoder ?? (column ? column[ColumnType].decode : null)
    }
  }

  /**
   * SQL "components" are things like modifiers and clauses that cannot
   * be executed directly. They rely on SQL statements to execute them.
   */
  export class Component<
    K extends string = string,
    Out = any,
  > extends SQL<Out> {
    protected [SQLDecoder]: SQL.Decoder<Out> | null = null

    constructor(keyword: K, decoder: SQL.Decoder<Out> | null = null) {
      super([keyword])
      this[SQLDecoder] = decoder
    }

    get [SQLKeyword]() {
      return this[PgSequence][0] as K
    }
  }

  /**
   * An executable query like SELECT, INSERT, CREATE, and so on.
   */
  export class Query<Out extends any[] = any[]> extends SQL<Out> {
    protected [SQLFields]: Record<string, SQL.Decoder> | null

    constructor(
      keyword: string,
      fields: Record<string, SQL.Decoder> | null = null
    ) {
      super([keyword])
      this[SQLFields] = fields
    }

    get [SQLKeyword]() {
      return this[PgSequence][0] as string
    }

    as(alias: string): AliasedQueryWithColumns<Out> {
      const query = new QueryIdentifier(alias, this)
      const fields = this[SQLFields]
      if (fields) {
        const subqueryId = ident(alias)
        return columnsProxy(query, name => {
          if (Object.prototype.hasOwnProperty.call(fields, name)) {
            return new SQL.ColumnReference(
              null,
              ident(name, subqueryId),
              fields[name]
            )
          }
        })
      }
      // INSERT, UPDATE, DELETE, etc. without a returning clause
      return query as AliasedQueryWithColumns<Out>
    }
  }

  /**
   * You get a `QueryIdentifier` when you call `as()` on a `Query`.
   */
  export class QueryIdentifier<Out extends any[] = any[]> extends Query<Out> {
    protected [SQLAlias]: Token.Identifier
    constructor(alias: string, statement: Query<Out>) {
      super(statement[SQLKeyword], statement[SQLFields])
      this[PgSequence] = statement[PgSequence]
      this[SequenceDelimiter] = statement[SequenceDelimiter]
      this[SQLAlias] = ident(alias)
    }
  }

  export type TableReference = Table | TableIdentifier | QueryIdentifier

  /**
   * Use “interface merging” to add your own custom primitives to the
   * SQL type system. The underlying client library needs to know how
   * to encode and decode these primitives to and from SQL.
   */
  export interface CustomPrimitives {}

  export type CustomPrimitive = CustomPrimitives[keyof CustomPrimitives]

  export type Primitive =
    | CustomPrimitive
    | string
    | number
    | bigint
    | boolean
    | Date
    | null
    | undefined

  export type Part =
    | pgTokens[keyof pgTokens]
    | SQL
    | Type
    | Table
    | Primitive
    | readonly Part[]

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
   * Infer the output type of a SQL part or column.
   */
  export type InferOutput<T extends Query | Column | Part> =
    T extends Type<any, any, infer TOutput>
      ? TOutput
      : T extends Query<infer TOutput>
        ? TOutput
        : T extends SQL<infer TOutput>
          ? TOutput
          : T extends Table<infer TColumns>
            ? {
                [K in keyof TColumns]: InferColumnType<TColumns[K]>
              }[]
            : T extends Column
              ? InferColumnType<T>
              : T extends Primitive
                ? T
                : unknown

  export type InferColumnType<T> =
    T extends Column<any, infer TOutput, infer TNullable>
      ? TOutput | (TNullable extends true ? null : never)
      : never
}

type toSQL<T extends readonly SQL.Part[]> = T[0] extends
  | SQL.Query
  | SQL.Expression
  | SQL.Component
  ? T[0]
  : SQL.Expression<unknown>

/**
 * Concatenate chunks of SQL. If later nested in a `SQL.Sequence`, the
 * chunks will be joined with that sequence's separator. Otherwise,
 * they're joined with a space.
 *
 * SQL instances are flattened (e.g. `sql(a, sql(b, c))` is the same
 * as `sql(a, b, c)`).
 */
export function sql<T extends SQL.Query | SQL.Expression | SQL.Component>(
  result: T,
  ...parts: SQL.Part[]
): T
export function sql<const T extends SQL.Part[]>(...parts: T): SQL.Expression<T>
export function sql(...parts: readonly SQL.Part[]) {
  return fromArray(parts)
}

function fromArray<
  const T extends readonly [
    SQL.Query | SQL.Expression | SQL.Component,
    ...SQL.Part[],
  ],
>(parts: T): T[0]
function fromArray<const T extends readonly SQL.Part[]>(parts: T): toSQL<T>
function fromArray(parts: readonly SQL.Part[]) {
  let root: SQL
  if (parts[0] instanceof SQL) [root, ...parts] = parts
  else root = new SQL.Expression()
  tokenize(parts, root[PgSequence])
  return root
}

sql.fromArray = fromArray

// Tokens
sql.ident = ident
sql.sequence = seq
sql.unsafe = unsafe

const jsonNull = { toJSON: () => null }

/**
 * If you need to store `"null"` in a `json` or `jsonb` column, use
 * this. JS nulls are always treated as SQL nulls, never as JSON
 * nulls.
 */
sql.jsonNull = () => jsonNull

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

/**
 * Useful for conditional syntax. If the condition is falsy, exclude
 * the given syntax from the query.
 *
 * ⚠️ The `condition` is JavaScript, not SQL. Use `caseWhen()` for SQL
 * conditions.
 *
 * @example
 * ```ts
 * select(users.id, $if(isAdmin, users.email), users.name)
 * ```
 */
export function $if<T>(
  condition: unknown,
  truthy: SQL<T>
): SQL<T | undefined> | typeof empty {
  return condition ? truthy : empty
}

/**
 * The `and` operator.
 *
 * @example
 * ```ts
 * query.where(x.is('!=', 0), and(y.is('!=', 0)), and(z.is('!=', 0)))
 * // WHERE x != 0 AND y != 0 AND z != 0
 * ```
 */
export function and(...parts: SQL.Part[]) {
  return new SQL.Component('and').$append(parts)
}

/**
 * Concatenate parts with the `and` operator. Empty parts are omitted.
 *
 * @example
 * ```ts
 * and.seq([x.is('!=', 0), y.is('!=', 0), z.is('!=', 0)])
 * // x != 0 AND y != 0 AND z != 0
 * ```
 */
and.seq = (parts: readonly SQL.Part[]) =>
  sql(seq(parts, unsafe('and'))).mapWith(boolean)

/**
 * The `or` operator.
 *
 * @example
 * ```ts
 * query.where(x.is('!=', 0), or(y.is('!=', 0)), or(z.is('!=', 0)))
 * // WHERE x != 0 OR y != 0 OR z != 0
 * ```
 */
export function or(...parts: SQL.Part[]) {
  return new SQL.Component('or').$append(parts)
}

/**
 * Concatenate parts with the `or` operator. Empty parts are omitted.
 *
 * @example
 * ```ts
 * or.seq([x.is('!=', 0), y.is('!=', 0), z.is('!=', 0)])
 * // x != 0 OR y != 0 OR z != 0
 * ```
 */
or.seq = (parts: readonly SQL.Part[]) =>
  sql(seq(parts, unsafe('or'))).mapWith(boolean)

/** The `not` operator. */
export function not(...parts: SQL.Part[]) {
  return sql(unsafe('not'), ...parts).mapWith(boolean)
}
