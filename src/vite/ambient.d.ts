/**
 * Opt-in ambient declarations for files carrying the `"use qubu"` hint.
 * Add `qubu/globals` to the project's TypeScript `types` or include this file
 * explicitly. The Vite plugin supplies the matching runtime imports.
 */

declare global {
  const add: typeof import('qubu').add
  const alias: typeof import('qubu').alias
  const aliasExpression: typeof import('qubu').aliasExpression
  const all: typeof import('qubu').all
  const allowAll: typeof import('qubu').allowAll
  const allowUnrestricted: typeof import('qubu').allowUnrestricted
  const and: typeof import('qubu').and
  const asExpression: typeof import('qubu').asExpression
  const asc: typeof import('qubu').asc
  const asValue: typeof import('qubu').asValue
  const avg: typeof import('qubu').avg
  const average: typeof import('qubu').average
  const bigint: typeof import('qubu').bigint
  const binary: typeof import('qubu').binary
  const blob: typeof import('qubu').blob
  const between: typeof import('qubu').between
  const boolean: typeof import('qubu').boolean
  const call: typeof import('qubu').call
  const caseWhen: typeof import('qubu').caseWhen
  const cast: typeof import('qubu').cast
  const coalesce: typeof import('qubu').coalesce
  const column: typeof import('qubu').column
  const commaSeparated: typeof import('qubu').commaSeparated
  const concat: typeof import('qubu').concat
  const count: typeof import('qubu').count
  const countDistinct: typeof import('qubu').countDistinct
  const correlate: typeof import('qubu').correlate
  const createDialect: typeof import('qubu').createDialect
  const crossJoin: typeof import('qubu').crossJoin
  const cte: typeof import('qubu').cte
  const customClause: typeof import('qubu').customClause
  const date: typeof import('qubu').date
  const dateTime: typeof import('qubu').dateTime
  const defaultValues: typeof import('qubu').defaultValues
  const deleteFrom: typeof import('qubu').deleteFrom
  const desc: typeof import('qubu').desc
  const distinct: typeof import('qubu').distinct
  const divide: typeof import('qubu').divide
  const eq: typeof import('qubu').eq
  const equal: typeof import('qubu').equal
  const except: typeof import('qubu').except
  const execute: typeof import('qubu').execute
  const executeQuery: typeof import('qubu').executeQuery
  const exists: typeof import('qubu').exists
  const fetchFirst: typeof import('qubu').fetchFirst
  const fetchNext: typeof import('qubu').fetchNext
  const fragment: typeof import('qubu').fragment
  const from: typeof import('qubu').from
  const fromSelect: typeof import('qubu').fromSelect
  const fullJoin: typeof import('qubu').fullJoin
  const groupBy: typeof import('qubu').groupBy
  const greaterThan: typeof import('qubu').greaterThan
  const greaterThanOrEqual: typeof import('qubu').greaterThanOrEqual
  const gt: typeof import('qubu').gt
  const gte: typeof import('qubu').gte
  const having: typeof import('qubu').having
  const identifier: typeof import('qubu').identifier
  const ilike: typeof import('qubu').ilike
  const inList: typeof import('qubu').inList
  const inQuery: typeof import('qubu').inQuery
  const inSelect: typeof import('qubu').inSelect
  const innerJoin: typeof import('qubu').innerJoin
  const integer: typeof import('qubu').integer
  const insertFrom: typeof import('qubu').insertFrom
  const insertInto: typeof import('qubu').insertInto
  const insertSelect: typeof import('qubu').insertSelect
  const intersect: typeof import('qubu').intersect
  const isDistinctFrom: typeof import('qubu').isDistinctFrom
  const isNotDistinctFrom: typeof import('qubu').isNotDistinctFrom
  const isNotNull: typeof import('qubu').isNotNull
  const isNull: typeof import('qubu').isNull
  const isTrue: typeof import('qubu').isTrue
  const json: typeof import('qubu').json
  const keyword: typeof import('qubu').keyword
  const leftJoin: typeof import('qubu').leftJoin
  const lateral: typeof import('qubu').lateral
  const like: typeof import('qubu').like
  const limit: typeof import('qubu').limit
  const lower: typeof import('qubu').lower
  const lt: typeof import('qubu').lt
  const lte: typeof import('qubu').lte
  const makeExpression: typeof import('qubu').makeExpression
  const max: typeof import('qubu').max
  const maximum: typeof import('qubu').maximum
  const min: typeof import('qubu').min
  const minimum: typeof import('qubu').minimum
  const modulo: typeof import('qubu').modulo
  const multiply: typeof import('qubu').multiply
  const naturalJoin: typeof import('qubu').naturalJoin
  const ne: typeof import('qubu').ne
  const not: typeof import('qubu').not
  const notEqual: typeof import('qubu').notEqual
  const notExists: typeof import('qubu').notExists
  const notIn: typeof import('qubu').notIn
  const notLike: typeof import('qubu').notLike
  const nullsFirst: typeof import('qubu').nullsFirst
  const nullsLast: typeof import('qubu').nullsLast
  const numeric: typeof import('qubu').numeric
  const nullable: typeof import('qubu').nullable
  const offset: typeof import('qubu').offset
  const or: typeof import('qubu').or
  const order: typeof import('qubu').order
  const orderBy: typeof import('qubu').orderBy
  const parameter: typeof import('qubu').parameter
  const parenthesize: typeof import('qubu').parenthesize
  const postgresDialect: typeof import('qubu').postgresDialect
  const qualifiedIdentifier: typeof import('qubu').qualifiedIdentifier
  const render: typeof import('qubu').render
  const rightJoin: typeof import('qubu').rightJoin
  const returning: typeof import('qubu').returning
  const routineName: typeof import('qubu').routineName
  const scalar: typeof import('qubu').scalar
  const select: typeof import('qubu').select
  const sequence: typeof import('qubu').sequence
  const standardDialect: typeof import('qubu').standardDialect
  const subtract: typeof import('qubu').subtract
  const sum: typeof import('qubu').sum
  const syntax: typeof import('qubu').syntax
  const table: typeof import('qubu').table
  const text: typeof import('qubu').text
  const timestamp: typeof import('qubu').timestamp
  const toSql: typeof import('qubu').toSql
  const union: typeof import('qubu').union
  const unionAll: typeof import('qubu').unionAll
  const unsafe: typeof import('qubu').unsafe
  const unsafeExpression: typeof import('qubu').unsafeExpression
  const unsafeMutation: typeof import('qubu').unsafeMutation
  const update: typeof import('qubu').update
  const upper: typeof import('qubu').upper
  const value: typeof import('qubu').value
  const values: typeof import('qubu').values
  const where: typeof import('qubu').where
  const withCte: typeof import('qubu').withCte
  const withQueries: typeof import('qubu').withQueries
  const mysqlDialect: typeof import('qubu').mysqlDialect
  const removeFrom: typeof import('qubu').removeFrom
  const sqliteDialect: typeof import('qubu').sqliteDialect

  type ColumnDefinition<
    TOutput = unknown,
    TNullable extends boolean = false,
    TInsert = TOutput,
    TUpdate = TInsert,
    THasDefault extends boolean = false,
    TGenerated extends boolean = false,
  > = import('qubu').ColumnDefinition<
    TOutput,
    TNullable,
    TInsert,
    TUpdate,
    THasDefault,
    TGenerated
  >
  type ColumnReference<
    TName extends string = string,
    TMetadata = never,
  > = import('qubu').ColumnReference<TName, TMetadata>
  type Dialect = import('qubu').Dialect
  type Expression<
    TMetadata = any,
    TKind extends import('qubu').ExpressionKind = import('qubu').ExpressionKind,
  > = import('qubu').Expression<TMetadata, TKind>
  type Fragment<TMetadata = any> = import('qubu').Fragment<TMetadata>
  type FragmentMeta = import('qubu').FragmentMeta
  type QueryCardinality = import('qubu').QueryCardinality
  type CardinalityMeta<
    TCardinality extends
      import('qubu').QueryCardinality = import('qubu').QueryCardinality,
  > = import('qubu').CardinalityMeta<TCardinality>
  type CardinalityOf<T> = import('qubu').CardinalityOf<T>
  type ResultMeta<TOutput, TNullableFrom = never> = import('qubu').ResultMeta<
    TOutput,
    TNullableFrom
  >
  type RequiresSourceMeta<TSource> = import('qubu').RequiresSourceMeta<TSource>
  type RequiresOuterSourceMeta<TSource> =
    import('qubu').RequiresOuterSourceMeta<TSource>
  type ProvidesOuterSourceMeta<TSource> =
    import('qubu').ProvidesOuterSourceMeta<TSource>
  type NullableSourceMeta<TSource> = import('qubu').NullableSourceMeta<TSource>
  type QueryAdapter = import('qubu').QueryAdapter
  type RenderedQuery = import('qubu').RenderedQuery
  type MutationQuery<
    TRow extends object = Record<string, unknown>,
    TKind extends import('qubu').MutationKind = import('qubu').MutationKind,
  > = import('qubu').MutationQuery<TRow, TKind>
  type Query<
    TRow extends object = import('qubu').Row,
    TCardinality extends
      import('qubu').QueryCardinality = import('qubu').QueryCardinality,
    TMetadata = never,
  > = import('qubu').Query<TRow, TCardinality, TMetadata>
  type SelectQuery<
    TRow extends object = Record<string, unknown>,
    TCardinality extends
      import('qubu').QueryCardinality = import('qubu').QueryCardinality,
    TMetadata = never,
  > = import('qubu').SelectQuery<TRow, TCardinality, TMetadata>
  type Source<
    TIdentity = unknown,
    TRow extends object = Record<string, unknown>,
    TMetadata = never,
  > = import('qubu').Source<TIdentity, TRow, TMetadata>
  type Table<
    TName extends string = string,
    TDefinitions extends
      import('qubu').TableDefinitions = import('qubu').TableDefinitions,
  > = import('qubu').Table<TName, TDefinitions>
}

export {}
