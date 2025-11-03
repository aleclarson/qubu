import { assert, mapValues, omit } from 'radashi'
import { BinaryOperator, binaryOperators } from '../binaryOperator.ts'
import { boolean } from '../data/boolean.ts'
import { Column } from '../definition/column.ts'
import {
  AliasedQueryWithColumns,
  getTableRef,
  Table,
} from '../definition/table.ts'
import { columnsProxy } from '../util.ts'
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
  TableColumns,
} from './symbols.ts'
import {
  comma,
  empty,
  escapeIdentifier,
  ident,
  pgTokens,
  renderIdentifier,
  renderTokens,
  seq,
  space,
  Token,
  tokenize,
  unsafe,
} from './tokens.ts'

declare const SQLOutputType: unique symbol

export class SQL<Out = any> implements Token.Sequence {
  declare [SQLOutputType]: Out;
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
    delimiter: Token.Syntax = this[SequenceDelimiter]
  ) {
    if (delimiter[PgSyntax] === this[SequenceDelimiter][PgSyntax]) {
      tokenize(parts, this[PgSequence], delimiter)
    } else {
      const { length } = this[PgSequence]

      const tokens = [this[PgSequence][length - 1]]
      tokenize(parts, tokens, delimiter)

      this[PgSequence][length - 1] = {
        [PgSequence]: tokens,
        [SequenceDelimiter]: delimiter,
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
    [PgExpression] = true as const;
    [SQLAlias]: Token.Identifier<Alias> | null = null;
    [SQLDecoder]: SQL.Decoder<Out> | null = null

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
      ]) as unknown as SQL<never>
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
      ]) as unknown as SQL<never>
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
  export class TableIdentifier<Out extends object = any> extends SQL<Out[]> {
    [PgTable]: Table<any>;
    [SQLAlias]: Token.Identifier

    constructor(alias: string, table: Table<any>) {
      const aliasToken = ident(alias)
      super([renderIdentifier(getTableRef(table)), 'as', aliasToken[PgIdent]])
      this[PgTable] = table
      this[SQLAlias] = aliasToken
    }

    /**
     * Select all columns from the table using wildcard syntax.
     * @returns `SQL.TableWildcard`
     */
    $all<TOmit extends string>(options: {
      omit: readonly TOmit[]
    }): SQL.TableWildcard<{
      [K in keyof Omit<Out, TOmit>]: Out[K]
    }>
    $all(): SQL.TableWildcard<Out>
    $all(options?: { omit?: readonly string[] }) {
      return new SQL.TableWildcard(this, options?.omit)
    }
  }

  /**
   * You get a `TableWildcard` when you access `["*"]` on a `Table`.
   */
  export class TableWildcard<Out extends object = any> extends SQL<Out[]> {
    [SQLFields]: Record<string, SQL.Decoder>

    constructor(
      table: Table<any> | TableIdentifier | QueryIdentifier,
      omitFields?: readonly string[]
    ) {
      let fields: Record<string, SQL.Decoder>
      if (table instanceof QueryIdentifier) {
        assert(
          table[SQLFields],
          'Query must be SELECT or have a RETURNING clause'
        )
        fields = table[SQLFields]
      } else {
        fields = mapValues(
          table instanceof Table
            ? table[TableColumns]
            : table[PgTable][TableColumns],
          column => {
            return column[ColumnType].decode
          }
        )
      }

      const tokens: Token[] = []
      const tableToken = renderIdentifier(
        table instanceof Table ? getTableRef(table) : table[SQLAlias]
      )

      if (omitFields) {
        fields = omit(fields, omitFields)

        const columns = seq([], comma)
        for (const name of Object.keys(fields)) {
          columns[PgSequence].push(`${tableToken}.${escapeIdentifier(name)}`)
        }
        tokens.push(columns)
      } else {
        tokens.push(tableToken + '.*')
      }

      super(tokens)
      this[SQLFields] = fields
    }
  }

  export class ColumnReference<
    Out = any,
    Name extends string = string,
  > extends Expression<Out, Name> {
    [PgColumn]: Column<any, Out> | null;
    [ColumnName]: Name

    constructor(
      column: Column<any, Out> | null,
      id?: Token.Identifier<Name>,
      decoder?: SQL.Decoder<Out>
    ) {
      let name: string
      let escapedName: string
      if (id) {
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
    [SQLDecoder]: SQL.Decoder<Out> | null = null

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
  export class Query<Out extends object = any> extends SQL<Out[]> {
    [SQLFields]: Record<string, SQL.Decoder> | null

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

    /**
     * Declare an alias for the query with the `as` operator. The
     * returned query identifier also has its columns mapped to column
     * references.
     * @returns `SQL.QueryIdentifier`
     */
    as<Name extends string>(alias: Name): AliasedQueryWithColumns<Out, Name> {
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
      return query as AliasedQueryWithColumns<Out, Name>
    }

    /**
     * Generate raw SQL from a `SQL.Query` object and return the
     * parameter values.
     */
    static toString(query: SQL.Query): [sql: string, params: unknown[]] {
      const tokens = query[PgSequence]
      const params: unknown[] = []
      return [renderTokens(tokens, params), params]
    }
  }

  /**
   * You get a `QueryIdentifier` when you call `as()` on a `Query`.
   */
  export class QueryIdentifier<
    Out extends object = any,
    Name extends string = string,
  > extends SQL<Out[]> {
    [SQLAlias]: Token.Identifier<Name>;
    [SQLFields]: Record<string, SQL.Decoder> | null

    constructor(alias: Name, query: Query<Out>) {
      super(query[PgSequence], query[SequenceDelimiter])
      this[SQLAlias] = ident(alias)
      this[SQLFields] = query[SQLFields]
    }

    /**
     * Select all columns from the table using wildcard syntax.
     * Optionally omit specific columns.
     * @returns `SQL.TableWildcard`
     */
    $all<TOmit extends string>(options: {
      omit: readonly TOmit[]
    }): SQL.TableWildcard<{
      [K in keyof Omit<Out, TOmit>]: Out[K]
    }>
    $all(): SQL.TableWildcard<Out>
    $all(options?: { omit?: readonly string[] }) {
      return new SQL.TableWildcard(this, options?.omit)
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
    T extends SQL<infer TOutput>
      ? TOutput
      : T extends Table<infer TColumns>
        ? {
            -readonly [K in keyof TColumns]: InferColumnType<TColumns[K]>
          }[]
        : T extends Column
          ? InferColumnType<T>
          : T extends Type<any, any, infer TOutput>
            ? TOutput
            : T extends Primitive
              ? T
              : unknown

  export type InferColumnType<T> =
    T extends Column<any, infer TOutput, infer TNullable>
      ? TOutput | (TNullable extends true ? null : never)
      : never
}

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
export function sql<Out>(...parts: SQL.Part[]): SQL.Expression<Out>
export function sql(...parts: readonly SQL.Part[]) {
  return fromArray(parts)
}

function fromArray<
  const T extends readonly [
    SQL.Query | SQL.Expression | SQL.Component,
    ...SQL.Part[],
  ],
>(parts: T): T[0]
function fromArray<Out>(parts: readonly SQL.Part[]): SQL.Expression<Out>
function fromArray(parts: readonly SQL.Part[]) {
  let root: SQL
  if (parts[0] instanceof SQL) [root, ...parts] = parts
  else root = new SQL.Expression()
  tokenize(parts, root[PgSequence], root[SequenceDelimiter])
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
