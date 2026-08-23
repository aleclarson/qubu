// The root entrypoint is the short path for table definitions and query
// authoring. Fragment internals, dialect construction, and schema metadata
// live behind `qubu/core` and `qubu/schema`.

export { execute } from './execution.ts'
export type {
  DriverValueEncoder,
  QueryAdapter,
  QueryExecutor,
} from './execution.ts'
export { render } from './core/render.ts'
export type { RenderedQuery, RenderOptions } from './core/render.ts'
export type {
  AggregateDependenciesOf,
  AggregateMeta,
  AnyFragment,
  CardinalityMeta,
  CardinalityOf,
  CapabilitiesOf,
  CapabilityMetadataOf,
  DependenciesOf,
  ExpressionMeta,
  Fragment,
  FragmentMeta,
  GroupingDependenciesOf,
  GroupingKeysOf,
  GroupingMeta,
  HasAggregate,
  HasSubquery,
  HasWindow,
  InheritedMetadata,
  InheritedMetadataOf,
  MetadataOf,
  NullableSourceMeta,
  NullableSourcesOf,
  NullabilityOf,
  OutputOf,
  ProvidesOuterOf,
  ProvidesOuterSourceMeta,
  ProvidesSourceMeta,
  QueryCardinality,
  RenderContext,
  RequiresCapabilityMeta,
  RenderFunction,
  ResultMeta,
  RequiresOf,
  RequiresOuterMetadataOf,
  RequiresOuterOf,
  RequiresOuterSourceMeta,
  RequiresSourceMeta,
  SqlTypeOf,
  SubqueryMeta,
  VisibleDependenciesOf,
  WindowMeta,
} from './core/fragment.ts'
export type {
  AnySqlType,
  SqlBigInt,
  SqlBinary,
  SqlBoolean,
  SqlDate,
  SqlDecimal,
  SqlEqualityComparable,
  SqlEqualityCompatible,
  SqlInteger,
  SqlJson,
  SqlNumericLike,
  SqlOrderCompatible,
  SqlOrderable,
  SqlSemanticType,
  SqlText,
  SqlTextLike,
  SqlTimestamp,
  SqlTypeSatisfies,
  SqlUnknown,
  SqlUuid,
} from './core/sql-types.ts'
export type {
  CastTarget,
  Dialect,
  DialectCapability,
  DialectCastTypes,
  DialectJson,
  DialectOptions,
  DialectPagination,
  JsonScalarKind,
  NamedCastTarget,
  PaginationKind,
  PaginationPart,
  PortableCastTarget,
  PortableCastType,
  SchemaLiteralRenderer,
} from './core/dialect.ts'

export { cast } from './expressions/cast.ts'
export { caseWhen } from './expressions/case.ts'
export {
  call,
  coalesce,
  concat,
  count,
  countDistinct,
  denseRank,
  lower,
  max,
  min,
  over,
  rank,
  rowNumber,
  schemaCall,
  sum,
  avg,
  upper,
} from './expressions/function.ts'
export { scalar } from './expressions/subquery.ts'
export {
  jsonBoolean,
  jsonExists,
  jsonNumber,
  jsonPath,
  jsonText,
} from './expressions/json.ts'
export {
  add,
  divide,
  modulo,
  multiply,
  subtract,
} from './expressions/operators/arithmetic.ts'
export { and, not, or } from './expressions/operators/logic.ts'
export {
  between,
  inList,
  notIn,
} from './expressions/operators/comparison/range.ts'
export {
  eq,
  gt,
  gte,
  isDistinctFrom,
  isNotDistinctFrom,
  like,
  lt,
  lte,
  ne,
  notLike,
} from './expressions/operators/comparison/relational.ts'
export {
  exists,
  inQuery,
  notExists,
} from './expressions/operators/comparison/subquery.ts'
export {
  isNotNull,
  isNull,
  isTrue,
} from './expressions/operators/comparison/null.ts'
export type {
  AnyExpression,
  AnySchemaExpression,
  Expression,
  ExpressionKind,
  ExpressionNullability,
  ExpressionOutput,
  ExpressionRequires,
  ExpressionSqlType,
  ExpressionWithOutput,
  SchemaExpression,
} from './expressions/types.ts'
export type { JsonPath } from './expressions/json.ts'
export type { ColumnDependency } from './expressions/column.ts'
export { asValue, value } from './expressions/value.ts'

export { alias, lateral } from './schema/alias.ts'
export {
  bigint,
  binary,
  boolean,
  column,
  date,
  integer,
  json,
  nativeColumn,
  nativeStorage,
  nullable,
  numeric,
  portableStorage,
  text,
  timestamp,
  uuid,
} from './schema/column.ts'
export { index } from './schema/indexes.ts'
export {
  externalDefault,
  externalGeneratedColumn,
  generatedColumn,
  identityColumn,
} from './schema/column-behavior.ts'
export {
  check,
  foreignKey,
  primaryKey,
  references,
  unique,
  uniqueConstraint,
} from './schema/constraints.ts'
export { schema } from './schema/registry.ts'
export { table } from './schema/table.ts'
export type {
  AnyTable,
  Table,
  TableDefinitions,
  TableIdentity,
  TableInsertInput,
  TableRow,
  TableSqlTypes,
  TableUpdateInput,
} from './schema/table.ts'
export type {
  ColumnDefinition,
  ColumnGeneratedOf,
  ColumnDefaultOf,
  ColumnHasDefault,
  ColumnIdentityOf,
  ColumnInsertInput,
  ColumnIsGenerated,
  ColumnOnUpdateOf,
  ColumnOutput,
  ColumnSqlType,
  ColumnStorage,
  ColumnStorageDeclarationOf,
  ColumnStorageDialectOf,
  ColumnStorageKindOf,
  ColumnStorageOf,
  ColumnStorageTypeOf,
  NativeColumnStorage,
  PortableColumnStorage,
} from './schema/column.ts'
export type {
  ColumnDefault,
  ColumnDefaultInput,
} from './schema/column-behavior.ts'
export type { ColumnReference } from './expressions/column.ts'
export type {
  AnySource,
  Source,
  SourceColumns,
  SourceConstraints,
  SourceIdentity,
  SourceKind,
  SourceProvision,
  ProvidedSourceIdentity,
  ProvidedSourceRow,
  SourceRow,
  SourceSqlTypeMap,
} from './schema/source.ts'
export type {
  AliasIdentity,
  AliasedSource,
  LateralIdentity,
  LateralSource,
  QueryAliasIdentity,
  QuerySource,
} from './schema/alias.ts'
export type {
  CanonicalLiteral,
  ColumnBehaviorError,
  ColumnBehaviorErrorCode,
  DefaultDescriptor,
  ExpressionDefaultDescriptor,
  ExpressionGeneratedColumnDescriptor,
  ExternalDefaultDescriptor,
  ExternalGeneratedColumnDescriptor,
  GeneratedColumnDescriptor,
  GeneratedColumnMode,
  GeneratedDescriptor,
  IdentityDescriptor,
  IdentityDialectExtension,
  IdentityGeneration,
  LiteralDefaultDescriptor,
  MysqlIdentityExtension,
  ResolvedColumnBehavior,
  SchemaLiteralValue,
  SqliteIdentityExtension,
} from './schema/column-behavior.ts'
export type {
  AnyKeyColumn,
  CheckConstraint,
  CheckConstraintOptions,
  ConstraintDialectExtension,
  ConstraintOptions,
  ConstraintTiming,
  FieldLike,
  FieldLikeOptions,
  ForeignKeyConstraint,
  ForeignKeyMatch,
  ForeignKeyOptions,
  ForeignKeyTarget,
  ForeignKeyTargetInput,
  KeyConstraint,
  KeyConstraintOptions,
  MysqlConstraintExtension,
  PostgresConstraintExtension,
  ReferentialAction,
  SourceConstraint,
  SourceConstraintsRecord,
  SourceLike,
  SqliteConstraintExtension,
  TableLike,
  UniqueConstraint,
  UniqueConstraintOptions,
  UniqueNullSemantics,
} from './schema/constraints.ts'
export type { SchemaDialect, SchemaDialectHooks } from './schema/dialect.ts'
export type {
  RenderedSchemaExpression,
  SchemaExpressionErrorCode,
  SchemaExpressionInput,
  SchemaExpressionMode,
  SchemaRenderContext,
  SchemaRenderOptions,
  UnsafeSchemaSqlExpression,
} from './schema/expressions.ts'
export type {
  IndexDialectExtension,
  IndexOptions,
  IndexTerm,
  MysqlIndexExtension,
  PostgresIndexExtension,
  SourceIndex,
  SourceIndexesRecord,
  SqliteIndexExtension,
  TableIndex,
} from './schema/indexes.ts'
export type {
  SchemaDialectExtension,
  SchemaDialectName,
  SchemaMetadataDiagnostic,
  SchemaObjectIdentity,
  SchemaObjectNameOptions,
} from './schema/metadata.ts'
export type {
  Schema,
  SchemaDiagnostic,
  SchemaNamingPolicy,
  SchemaOptions,
  SchemaTableEntry,
  SchemaTableNames,
  SchemaTableRecord,
  SchemaTableRegistry,
} from './schema/registry.ts'

export { all } from './query/selection.ts'
export type {
  Selection,
  SelectionObject,
  SelectionOutput,
  SelectionSqlTypes,
} from './query/selection.ts'
export { select } from './query/select.ts'
export type {
  AvailableOuterScope,
  AvailableScope,
  ClauseScope,
  GroupingValidation,
  MissingScope,
  RequiredOuterScope,
  RequiredScope,
  ScopeValidation,
  SelectCardinality,
  SelectQuery,
} from './query/select.ts'
export { except, intersect, union, unionAll } from './query/set.ts'
export type { SetOperator } from './query/set.ts'
export { omit } from './query/omit.ts'
export type { Omit, OmittableSelectClause, SelectPart } from './query/omit.ts'

export { correlate } from './query/clauses/correlate.ts'
export { distinct } from './query/clauses/distinct.ts'
export { from } from './query/clauses/from.ts'
export type { FromClause, FromScope, FromSource } from './query/clauses/from.ts'
export { groupBy } from './query/clauses/group-by.ts'
export { having } from './query/clauses/having.ts'
export {
  crossJoin,
  fullJoin,
  innerJoin,
  leftJoin,
  naturalJoin,
  rightJoin,
} from './query/clauses/joins.ts'
export {
  asc,
  desc,
  nullsFirst,
  nullsLast,
  order,
  orderBy,
} from './query/clauses/order-by.ts'
export { fetchFirst, fetchNext, offset } from './query/clauses/pagination.ts'
export { where } from './query/clauses/where.ts'
export { cte, withCte } from './query/clauses/with.ts'
export type { CteSource, WithClause } from './query/clauses/with.ts'
export type {
  AnySelectClause,
  ClausePlacement,
  SelectClause,
} from './query/clauses/types.ts'

export {
  defaultValues,
  insertInto,
  insertSelect,
  values,
} from './query/mutation/insert.ts'
export type {
  DefaultValuesSource,
  InsertSelectSource,
  InsertSource,
  ValuesSource,
} from './query/mutation/insert.ts'
export { update } from './query/mutation/update.ts'
export type {
  UpdateAssignments,
  UpdateAssignmentValue,
} from './query/mutation/update.ts'
export { deleteFrom } from './query/mutation/delete.ts'
export { allowAll } from './query/mutation/types.ts'
export type {
  AllowAllClause,
  MutationClause,
  MutationKind,
  MutationQuery,
  MutationReturning,
  MutationReturningClause,
  MutationRow,
  MutationScopeValidation,
  MutationSqlTypes,
} from './query/mutation/types.ts'
export { returning } from './query/mutation/returning.ts'
export type {
  ReturningClause,
  ReturningRow,
  ReturningSqlTypes,
} from './query/mutation/returning.ts'

export type {
  AnyQuery,
  Query,
  QueryKind,
  QueryRow,
  QuerySqlTypeMap,
  Row,
} from './query/types.ts'
export {
  QueryValidationError,
  type QueryValidationErrorCode,
  type QueryValidationIssue,
  type QueryTypeValidation,
} from './query/errors.ts'
