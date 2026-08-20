/**
 * Opt-in ambient declarations for files carrying the `"use qubu"` hint.
 * Add `qubu/globals` to the project's TypeScript `types` or include this file
 * explicitly. The Vite plugin supplies the matching runtime imports.
 */

declare global {
  const add: typeof import('qubu').add
  const alias: typeof import('qubu').alias
  const all: typeof import('qubu').all
  const allowAll: typeof import('qubu').allowAll
  const allowUnrestricted: typeof import('qubu').allowUnrestricted
  const and: typeof import('qubu').and
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
  const check: typeof import('qubu').check
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
  const defaultExpression: typeof import('qubu').defaultExpression
  const defaultLiteral: typeof import('qubu').defaultLiteral
  const dialectColumn: typeof import('qubu').dialectColumn
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
  const externalDefault: typeof import('qubu').externalDefault
  const externalGeneratedColumn: typeof import('qubu').externalGeneratedColumn
  const exists: typeof import('qubu').exists
  const fetchFirst: typeof import('qubu').fetchFirst
  const fetchNext: typeof import('qubu').fetchNext
  const fragment: typeof import('qubu').fragment
  const foreignKey: typeof import('qubu').foreignKey
  const from: typeof import('qubu').from
  const fromSelect: typeof import('qubu').fromSelect
  const fullJoin: typeof import('qubu').fullJoin
  const groupBy: typeof import('qubu').groupBy
  const generatedColumn: typeof import('qubu').generatedColumn
  const greaterThan: typeof import('qubu').greaterThan
  const greaterThanOrEqual: typeof import('qubu').greaterThanOrEqual
  const gt: typeof import('qubu').gt
  const gte: typeof import('qubu').gte
  const having: typeof import('qubu').having
  const identifier: typeof import('qubu').identifier
  const ilike: typeof import('qubu').ilike
  const identityColumn: typeof import('qubu').identityColumn
  const inList: typeof import('qubu').inList
  const inQuery: typeof import('qubu').inQuery
  const inSelect: typeof import('qubu').inSelect
  const index: typeof import('qubu').index
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
  const jsonBoolean: typeof import('qubu').jsonBoolean
  const jsonExists: typeof import('qubu').jsonExists
  const jsonNumber: typeof import('qubu').jsonNumber
  const jsonPath: typeof import('qubu').jsonPath
  const jsonText: typeof import('qubu').jsonText
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
  const nativeColumn: typeof import('qubu').nativeColumn
  const nativeStorage: typeof import('qubu').nativeStorage
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
  const omit: typeof import('qubu').omit
  const or: typeof import('qubu').or
  const order: typeof import('qubu').order
  const orderBy: typeof import('qubu').orderBy
  const parameter: typeof import('qubu').parameter
  const parenthesize: typeof import('qubu').parenthesize
  const postgresDialect: typeof import('qubu').postgresDialect
  const portableStorage: typeof import('qubu').portableStorage
  const primaryKey: typeof import('qubu').primaryKey
  const qualifiedIdentifier: typeof import('qubu').qualifiedIdentifier
  const references: typeof import('qubu').references
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
  const unique: typeof import('qubu').unique
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
    TSqlType extends import('qubu').AnySqlType = import('qubu').SqlUnknown,
    TStorage extends import('qubu').ColumnStorage | undefined = undefined,
    TDefault extends import('qubu').ColumnDefault | undefined =
      | import('qubu').ColumnDefault
      | undefined,
    TGeneratedColumn extends
      | import('qubu').GeneratedColumnDescriptor
      | undefined = import('qubu').GeneratedColumnDescriptor | undefined,
    TIdentity extends import('qubu').IdentityDescriptor | undefined =
      | import('qubu').IdentityDescriptor
      | undefined,
    TOnUpdate extends import('qubu').AnySchemaExpression | undefined =
      | import('qubu').AnySchemaExpression
      | undefined,
  > = import('qubu').ColumnDefinition<
    TOutput,
    TNullable,
    TInsert,
    TUpdate,
    THasDefault,
    TGenerated,
    TSqlType,
    TStorage,
    TDefault,
    TGeneratedColumn,
    TIdentity,
    TOnUpdate
  >
  type ColumnSqlType<T> = import('qubu').ColumnSqlType<T>
  type ColumnDefault = import('qubu').ColumnDefault
  type ColumnDefaultOf<T> = import('qubu').ColumnDefaultOf<T>
  type ColumnGeneratedOf<T> = import('qubu').ColumnGeneratedOf<T>
  type ColumnIdentityOf<T> = import('qubu').ColumnIdentityOf<T>
  type ColumnOnUpdateOf<T> = import('qubu').ColumnOnUpdateOf<T>
  type GeneratedColumnDescriptor = import('qubu').GeneratedColumnDescriptor
  type IdentityDescriptor = import('qubu').IdentityDescriptor
  type MysqlIdentityExtension = import('qubu').MysqlIdentityExtension
  type ColumnStorage = import('qubu').ColumnStorage
  type PortableStorageType = import('qubu').PortableStorageType
  type PortableColumnStorage<
    TType extends
      import('qubu').PortableStorageType = import('qubu').PortableStorageType,
  > = import('qubu').PortableColumnStorage<TType>
  type NativeColumnStorage<
    TDialect extends string = string,
    TDeclaration extends string = string,
  > = import('qubu').NativeColumnStorage<TDialect, TDeclaration>
  type ColumnStorageOf<T> = import('qubu').ColumnStorageOf<T>
  type ColumnStorageType<T> = import('qubu').ColumnStorageType<T>
  type ColumnStorageTypeOf<T> = import('qubu').ColumnStorageTypeOf<T>
  type ColumnStorageDialectOf<T> = import('qubu').ColumnStorageDialectOf<T>
  type ColumnStorageDeclarationOf<T> =
    import('qubu').ColumnStorageDeclarationOf<T>
  type ColumnStorageKindOf<T> = import('qubu').ColumnStorageKindOf<T>
  type StorageOf<T> = import('qubu').StorageOf<T>
  type ColumnReference<
    TName extends string = string,
    TMetadata = never,
  > = import('qubu').ColumnReference<TName, TMetadata>
  type Dialect<
    TCapabilities extends
      import('qubu').DialectCapability = import('qubu').DialectCapability,
  > = import('qubu').Dialect<TCapabilities>
  type DialectCapability = import('qubu').DialectCapability
  type DialectJson = import('qubu').DialectJson
  type PortableCastType = import('qubu').PortableCastType
  type PortableCastTarget<
    TType extends
      import('qubu').PortableCastType = import('qubu').PortableCastType,
  > = import('qubu').PortableCastTarget<TType>
  type NamedCastTarget<TTypeName extends string = string> =
    import('qubu').NamedCastTarget<TTypeName>
  type CastTarget = import('qubu').CastTarget
  type DialectCastTypes = import('qubu').DialectCastTypes
  type Expression<
    TMetadata = any,
    TKind extends import('qubu').ExpressionKind = import('qubu').ExpressionKind,
  > = import('qubu').Expression<TMetadata, TKind>
  type Fragment<TMetadata = any> = import('qubu').Fragment<TMetadata>
  type FragmentMeta = import('qubu').FragmentMeta
  type JsonPath<
    TSegments extends
      readonly import('qubu').JsonPathSegment[] = readonly import('qubu').JsonPathSegment[],
  > = import('qubu').JsonPath<TSegments>
  type JsonPathSegment = import('qubu').JsonPathSegment
  type JsonScalarKind = import('qubu').JsonScalarKind
  type QueryCardinality = import('qubu').QueryCardinality
  type CardinalityMeta<
    TCardinality extends
      import('qubu').QueryCardinality = import('qubu').QueryCardinality,
  > = import('qubu').CardinalityMeta<TCardinality>
  type CardinalityOf<T> = import('qubu').CardinalityOf<T>
  type CapabilitiesOf<T> = import('qubu').CapabilitiesOf<T>
  type HasSubquery<T> = import('qubu').HasSubquery<T>
  type HasWindow<T> = import('qubu').HasWindow<T>
  type SubqueryMeta = import('qubu').SubqueryMeta
  type WindowMeta = import('qubu').WindowMeta
  type ResultMeta<
    TOutput,
    TNullableFrom = never,
    TSqlType extends import('qubu').AnySqlType = import('qubu').SqlUnknown,
  > = import('qubu').ResultMeta<TOutput, TNullableFrom, TSqlType>
  type SqlTypeOf<T> = import('qubu').SqlTypeOf<T>
  type SqlSemanticType<TName extends string = string> =
    import('qubu').SqlSemanticType<TName>
  type AnySqlType = import('qubu').AnySqlType
  type SqlUnknown = import('qubu').SqlUnknown
  type SqlTextLike = import('qubu').SqlTextLike
  type SqlNumericLike = import('qubu').SqlNumericLike
  type SqlOrderable<TGroup = unknown> = import('qubu').SqlOrderable<TGroup>
  type SqlEqualityComparable<TGroup = unknown> =
    import('qubu').SqlEqualityComparable<TGroup>
  type SqlText = import('qubu').SqlText
  type SqlUuid = import('qubu').SqlUuid
  type SqlInteger = import('qubu').SqlInteger
  type SqlDecimal = import('qubu').SqlDecimal
  type SqlBoolean = import('qubu').SqlBoolean
  type SqlDate = import('qubu').SqlDate
  type SqlTimestamp = import('qubu').SqlTimestamp
  type SqlJson<TValue = unknown> = import('qubu').SqlJson<TValue>
  type SqlBigInt = import('qubu').SqlBigInt
  type SqlBinary = import('qubu').SqlBinary
  type SqlTypeSatisfies<TActual, TConstraint> = import('qubu').SqlTypeSatisfies<
    TActual,
    TConstraint
  >
  type SqlEqualityCompatible<TLeft, TRight> =
    import('qubu').SqlEqualityCompatible<TLeft, TRight>
  type SqlOrderCompatible<TLeft, TRight> = import('qubu').SqlOrderCompatible<
    TLeft,
    TRight
  >
  type FieldLike<
    TOptions extends
      import('qubu').FieldLikeOptions = import('qubu').FieldLikeOptions,
  > = import('qubu').FieldLike<TOptions>
  type SourceLike<TShape extends object> = import('qubu').SourceLike<TShape>
  type TableLike<TShape extends object> = import('qubu').TableLike<TShape>
  type RequiresSourceMeta<TSource> = import('qubu').RequiresSourceMeta<TSource>
  type RequiresOuterSourceMeta<TSource> =
    import('qubu').RequiresOuterSourceMeta<TSource>
  type ProvidesOuterSourceMeta<TSource> =
    import('qubu').ProvidesOuterSourceMeta<TSource>
  type NullableSourceMeta<TSource> = import('qubu').NullableSourceMeta<TSource>
  type RequiresCapabilityMeta<
    TCapability extends
      import('qubu').DialectCapability = import('qubu').DialectCapability,
  > = import('qubu').RequiresCapabilityMeta<TCapability>
  type QueryAdapter = import('qubu').QueryAdapter
  type RenderedQuery = import('qubu').RenderedQuery
  type MutationQuery<
    TRow extends object = Record<string, unknown>,
    TKind extends import('qubu').MutationKind = import('qubu').MutationKind,
    TMetadata = never,
  > = import('qubu').MutationQuery<TRow, TKind, TMetadata>
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
    TSqlTypes extends
      import('qubu').SourceSqlTypes<TRow> = import('qubu').UnknownSourceSqlTypes<TRow>,
    TConstraints extends import('qubu').SourceConstraintsRecord = {},
  > = import('qubu').Source<TIdentity, TRow, TMetadata, TSqlTypes, TConstraints>
  type SourceConstraint = import('qubu').SourceConstraint
  type SourceConstraintsRecord = import('qubu').SourceConstraintsRecord
  type SourceIndexesRecord = import('qubu').SourceIndexesRecord
  type SourceIndex = import('qubu').SourceIndex
  type SchemaDialect = import('qubu').SchemaDialect
  type SchemaDialectExtension<TDialect extends string = string> =
    import('qubu').SchemaDialectExtension<TDialect>
  type SchemaObjectIdentity = import('qubu').SchemaObjectIdentity
  type SchemaObjectNameOptions = import('qubu').SchemaObjectNameOptions
  type SchemaMetadataDiagnostic = import('qubu').SchemaMetadataDiagnostic
  type SchemaMetadataValidationError =
    import('qubu').SchemaMetadataValidationError
  type ConstraintDialectExtension = import('qubu').ConstraintDialectExtension
  type PostgresConstraintExtension = import('qubu').PostgresConstraintExtension
  type SqliteConstraintExtension = import('qubu').SqliteConstraintExtension
  type MysqlConstraintExtension = import('qubu').MysqlConstraintExtension
  type ConstraintOptions<
    TExtension extends import('qubu').ConstraintDialectExtension | undefined =
      | import('qubu').ConstraintDialectExtension
      | undefined,
  > = import('qubu').ConstraintOptions<TExtension>
  type KeyConstraintOptions<
    TExtension extends import('qubu').ConstraintDialectExtension | undefined =
      | import('qubu').ConstraintDialectExtension
      | undefined,
  > = import('qubu').KeyConstraintOptions<TExtension>
  type UniqueConstraintOptions<
    TExtension extends import('qubu').ConstraintDialectExtension | undefined =
      | import('qubu').ConstraintDialectExtension
      | undefined,
  > = import('qubu').UniqueConstraintOptions<TExtension>
  type ForeignKeyOptions<
    TExtension extends import('qubu').ConstraintDialectExtension | undefined =
      | import('qubu').ConstraintDialectExtension
      | undefined,
  > = import('qubu').ForeignKeyOptions<TExtension>
  type UniqueNullSemantics = import('qubu').UniqueNullSemantics
  type ReferentialAction = import('qubu').ReferentialAction
  type ForeignKeyMatch = import('qubu').ForeignKeyMatch
  type ConstraintTiming = import('qubu').ConstraintTiming
  type AnyKeyColumn = import('qubu').AnyKeyColumn
  type KeyConstraint<
    TKind extends 'primary-key' | 'unique' = 'primary-key' | 'unique',
    TColumns extends readonly import('qubu').ColumnReference<
      string,
      any
    >[] = readonly import('qubu').ColumnReference<string, any>[],
  > = import('qubu').KeyConstraint<TKind, TColumns>
  type UniqueConstraint<
    TColumns extends
      readonly import('qubu').AnyKeyColumn[] = readonly import('qubu').AnyKeyColumn[],
    TNulls extends
      import('qubu').UniqueNullSemantics = import('qubu').UniqueNullSemantics,
  > = import('qubu').UniqueConstraint<TColumns, TNulls>
  type ForeignKeyTarget<
    TTable extends
      import('qubu').TableLike<any> = import('qubu').TableLike<any>,
    TColumns extends
      readonly import('qubu').AnyKeyColumn[] = readonly import('qubu').AnyKeyColumn[],
  > = import('qubu').ForeignKeyTarget<TTable, TColumns>
  type ForeignKeyTargetInput<
    TTarget extends
      import('qubu').ForeignKeyTarget = import('qubu').ForeignKeyTarget,
  > = import('qubu').ForeignKeyTargetInput<TTarget>
  type ForeignKeyConstraint<
    TColumns extends
      readonly import('qubu').AnyKeyColumn[] = readonly import('qubu').AnyKeyColumn[],
    TTarget extends
      import('qubu').ForeignKeyTargetInput = import('qubu').ForeignKeyTargetInput,
  > = import('qubu').ForeignKeyConstraint<TColumns, TTarget>
  type CheckConstraint<
    TExpression extends
      import('qubu').AnyExpression = import('qubu').AnyExpression,
  > = import('qubu').CheckConstraint<TExpression>
  type CheckConstraintOptions<
    TExtension extends import('qubu').ConstraintDialectExtension | undefined =
      | import('qubu').ConstraintDialectExtension
      | undefined,
  > = import('qubu').CheckConstraintOptions<TExtension>
  type IndexDialectExtension = import('qubu').IndexDialectExtension
  type PostgresIndexExtension = import('qubu').PostgresIndexExtension
  type SqliteIndexExtension = import('qubu').SqliteIndexExtension
  type MysqlIndexExtension = import('qubu').MysqlIndexExtension
  type IndexTerm = import('qubu').IndexTerm
  type IndexOptions<
    TPredicate extends import('qubu').AnyExpression | undefined =
      | import('qubu').AnyExpression
      | undefined,
    TExtension extends import('qubu').IndexDialectExtension | undefined =
      | import('qubu').IndexDialectExtension
      | undefined,
  > = import('qubu').IndexOptions<TPredicate, TExtension>
  type TableIndex<
    TTerms extends readonly import('qubu').IndexTerm[] = any,
    TOptions extends import('qubu').IndexOptions<any> = any,
  > = import('qubu').TableIndex<TTerms, TOptions>
  type Table<
    TName extends string = string,
    TDefinitions extends
      import('qubu').TableDefinitions = import('qubu').TableDefinitions,
    TConstraints extends import('qubu').SourceConstraintsRecord = {},
    TIndexes extends import('qubu').SourceIndexesRecord = {},
  > = import('qubu').Table<TName, TDefinitions, TConstraints, TIndexes>
  type TableMetadataCallback<
    TName extends string,
    TDefinitions extends import('qubu').TableDefinitions,
    TConstraints extends import('qubu').SourceConstraintsRecord,
    TIndexes extends import('qubu').SourceIndexesRecord,
  > = import('qubu').TableMetadataCallback<
    TName,
    TDefinitions,
    TConstraints,
    TIndexes
  >
}

export {}
