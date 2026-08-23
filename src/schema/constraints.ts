import type {
  DependenciesOf,
  ExpressionMeta,
  Fragment,
  OutputOf,
  SqlTypeOf,
  RequiresSourceMeta,
  ResultMeta,
} from '../core/fragment.ts'
import type { AnySqlType, SqlBoolean, SqlUnknown } from '../core/sql-types.ts'
import type {
  AnyExpression,
  Expression,
  SchemaExpression,
} from '../expressions/types.ts'
import {
  isColumnReference,
  type ColumnDependency,
  type ColumnReference,
} from '../expressions/column.ts'
import { unsafeSchemaSql } from './expressions.ts'
import type { DeclaredColumnNullabilityOf } from './column-nullability.ts'
import type {
  SchemaDialectExtension,
  SchemaDialectName,
  SchemaObjectIdentity,
  SchemaObjectNameOptions,
} from './metadata.ts'
import { dialectMismatchDiagnostic, freezeSchemaMetadata } from './metadata.ts'
import { sourceIdentity, type SourceKind } from './source.ts'

declare const fieldConstraint: unique symbol

/** Application and SQL facts that a reusable source field may require. */
export interface FieldLikeOptions {
  readonly output?: unknown
  readonly sqlType?: object
  readonly nullable?: boolean
}

/**
 * A reusable source-field requirement combining application and SQL facts.
 * Omitted facts impose no constraint; `nullable: false` requires a non-null
 * selected value.
 */
export interface FieldLike<
  TOptions extends FieldLikeOptions = FieldLikeOptions,
> {
  readonly [fieldConstraint]: TOptions
}

type FieldOptions<T> = T extends FieldLike<infer TOptions> ? TOptions : never

type RequiredOutput<T> =
  T extends FieldLike<any>
    ? FieldOptions<T> extends { readonly output: infer TOutput }
      ? FieldOptions<T> extends { readonly nullable: false }
        ? NonNullable<TOutput>
        : TOutput
      : FieldOptions<T> extends { readonly nullable: false }
        ? {}
        : unknown
    : T

type RequiredSqlType<T> =
  T extends FieldLike<any>
    ? FieldOptions<T> extends { readonly sqlType: infer TSqlType }
      ? (AnySqlType & TSqlType) | SqlUnknown
      : AnySqlType
    : AnySqlType

type RequiredColumn<
  TField extends string,
  TRequirement,
  TIdentity,
> = ColumnReference<
  TField,
  | ResultMeta<
      RequiredOutput<TRequirement>,
      TIdentity,
      RequiredSqlType<TRequirement>
    >
  | RequiresSourceMeta<TIdentity>
  | ExpressionMeta<ColumnDependency<TIdentity, TField>>
>

type RequiredColumns<TShape extends object, TIdentity> = {
  readonly [K in keyof TShape]-?: K extends string
    ? RequiredColumn<K, TShape[K], TIdentity>
    : never
}

/**
 * A source containing at least the requested application and SQL fields.
 * Additional fields and the concrete source identity are preserved by generic
 * functions that accept this lower-bound constraint.
 */
export interface SourceLike<TShape extends object> extends Fragment<any> {
  readonly sourceKind: SourceKind
  readonly [sourceIdentity]: unknown
  readonly reference: Fragment<never>
  readonly columns: RequiredColumns<TShape, this[typeof sourceIdentity]>
}

/** The physical-table form of the lower-bound {@link SourceLike} constraint. */
export interface TableLike<TShape extends object> extends SourceLike<TShape> {
  readonly tableName: string
  readonly definitions: object
  readonly sqlNames: Readonly<Record<string, string>>
}

/** Standard SQL referential action retained on a foreign-key constraint. */
export type ReferentialAction =
  | 'no-action'
  | 'restrict'
  | 'cascade'
  | 'set-null'
  | 'set-default'

/** Standard SQL match mode for a composite foreign key. */
export type ForeignKeyMatch = 'simple' | 'full' | 'partial'

/** Deferrability timing for a foreign-key or key constraint. */
export type ConstraintTiming = 'immediate' | 'deferred'

/** PostgreSQL-only constraint options retained for a schema adapter. */
export interface PostgresConstraintExtension
  extends SchemaDialectExtension<'postgresql'> {
  /** PostgreSQL `NOT VALID` validation state for a constraint. */
  readonly notValid?: boolean
}

/** SQLite-only table-constraint options. */
export interface SqliteConstraintExtension
  extends SchemaDialectExtension<'sqlite'> {
  /** SQLite conflict policy attached to a table constraint. */
  readonly onConflict?: 'rollback' | 'abort' | 'fail' | 'ignore' | 'replace'
}

/** MySQL-only constraint options. */
export interface MysqlConstraintExtension
  extends SchemaDialectExtension<'mysql'> {
  /** MySQL 8 constraint enforcement state. */
  readonly enforced?: boolean
}

/** First-party and user-defined dialect extensions for constraints. */
export type ConstraintDialectExtension =
  | PostgresConstraintExtension
  | SqliteConstraintExtension
  | MysqlConstraintExtension
  | (SchemaDialectExtension<string> & Readonly<Record<string, unknown>>)

/** Shared physical-name and dialect-extension options for constraints. */
export interface ConstraintOptions<
  TExtension extends ConstraintDialectExtension | undefined =
    | ConstraintDialectExtension
    | undefined,
> extends SchemaObjectNameOptions {
  /** Engine-specific metadata owned by a future schema adapter. */
  readonly dialect?: TExtension
}

/** Options for primary-key and candidate-key declarations. */
export interface KeyConstraintOptions<
  TExtension extends ConstraintDialectExtension | undefined =
    | ConstraintDialectExtension
    | undefined,
> extends ConstraintOptions<TExtension> {
  /** Whether the key can be deferred by a supporting dialect. */
  readonly deferrable?: boolean
  /** Initial enforcement timing for a deferrable key. */
  readonly initially?: ConstraintTiming
}

/** Options for a database unique constraint, including nullable columns. */
export interface UniqueConstraintOptions<
  TExtension extends ConstraintDialectExtension | undefined =
    | ConstraintDialectExtension
    | undefined,
> extends ConstraintOptions<TExtension> {
  /**
   * SQL NULL comparison semantics. `distinct` is the common default in which
   * multiple NULL values do not conflict; `not-distinct` permits at most one.
   */
  readonly nulls?: UniqueNullSemantics
  /** Whether the constraint can be deferred by a supporting dialect. */
  readonly deferrable?: boolean
  /** Initial enforcement timing for a deferrable constraint. */
  readonly initially?: ConstraintTiming
}

/** Explicit NULL behavior for a database uniqueness rule. */
export type UniqueNullSemantics = 'distinct' | 'not-distinct'

/** Options for a table check constraint. */
export interface CheckConstraintOptions<
  TExtension extends ConstraintDialectExtension | undefined =
    | ConstraintDialectExtension
    | undefined,
> extends ConstraintOptions<TExtension> {
  /** Whether the check can be deferred by a supporting dialect. */
  readonly deferrable?: boolean
  /** Initial enforcement timing for a deferrable check. */
  readonly initially?: ConstraintTiming
}

/** Dialect tag and parameter-free SQL needed to reconstruct a catalog check. */
export interface CatalogCheckSql<
  TDialect extends SchemaDialectName = SchemaDialectName,
> {
  /** Catalog dialect that supplied the check expression. */
  readonly dialect: TDialect
  /** Opaque SQL text recovered from the catalog. */
  readonly sql: string
}

/** Options for a foreign-key declaration. */
export interface ForeignKeyOptions<
  TExtension extends ConstraintDialectExtension | undefined =
    | ConstraintDialectExtension
    | undefined,
> extends ConstraintOptions<TExtension> {
  readonly onUpdate?: ReferentialAction
  readonly onDelete?: ReferentialAction
  readonly match?: ForeignKeyMatch
  readonly deferrable?: boolean
  readonly initially?: ConstraintTiming
}

/** A schema constraint whose columns form a relational key. */
export interface KeyConstraint<
  TKind extends 'primary-key' | 'unique' = 'primary-key' | 'unique',
  TColumns extends readonly ColumnReference<
    string,
    any
  >[] = readonly ColumnReference<string, any>[],
> extends SchemaObjectIdentity {
  readonly kind: TKind
  readonly columns: TColumns
  readonly physicalName?: string
  readonly dialect?: ConstraintDialectExtension
  readonly deferrable?: boolean
  readonly initially?: ConstraintTiming
}

/** A referenced table and exact candidate-key column tuple. */
export interface ForeignKeyTarget<
  TTable extends TableLike<any> = TableLike<any>,
  TColumns extends readonly AnyKeyColumn[] = readonly AnyKeyColumn[],
> {
  readonly table: TTable
  readonly columns: TColumns
}

export type ForeignKeyTargetInput<
  TTarget extends ForeignKeyTarget = ForeignKeyTarget,
> = TTarget | (() => TTarget)

/** A foreign key from local columns to a direct or lazily resolved target. */
export interface ForeignKeyConstraint<
  TColumns extends readonly AnyKeyColumn[] = readonly AnyKeyColumn[],
  TTarget extends ForeignKeyTargetInput = ForeignKeyTargetInput,
> extends SchemaObjectIdentity {
  readonly kind: 'foreign-key'
  readonly columns: TColumns
  readonly target: TTarget
  readonly physicalName?: string
  readonly dialect?: ConstraintDialectExtension
  readonly onUpdate?: ReferentialAction
  readonly onDelete?: ReferentialAction
  readonly match?: ForeignKeyMatch
  readonly deferrable?: boolean
  readonly initially?: ConstraintTiming
}

/** Database uniqueness that deliberately does not prove a candidate key. */
export interface UniqueConstraint<
  TColumns extends readonly AnyKeyColumn[] = readonly AnyKeyColumn[],
  TNulls extends UniqueNullSemantics = UniqueNullSemantics,
> extends SchemaObjectIdentity {
  readonly kind: 'unique-constraint'
  readonly columns: TColumns
  readonly nulls: TNulls
  readonly physicalName?: string
  readonly dialect?: ConstraintDialectExtension
  readonly deferrable?: boolean
  readonly initially?: ConstraintTiming
}

/** A table-scoped boolean invariant. */
export interface CheckConstraint<
  TExpression extends AnyExpression = AnyExpression,
> extends SchemaObjectIdentity {
  readonly kind: 'check'
  readonly expression: TExpression
  readonly physicalName?: string
  readonly dialect?: ConstraintDialectExtension
  readonly deferrable?: boolean
  readonly initially?: ConstraintTiming
}

/**
 * Opaque catalog SQL whose check-constraint origin proves a boolean SQL
 * semantic type. The expression remains dialect-tagged and parameter-free.
 */
export interface CatalogCheckExpression<
  TDialect extends SchemaDialectName = SchemaDialectName,
> extends SchemaExpression<
    ResultMeta<boolean, never, SqlBoolean> | ExpressionMeta<never>,
    'unsafe'
  > {
  readonly schemaSqlDialect: TDialect
  readonly schemaSql: string
}

/** Structured schema metadata carried by sources that declare constraints. */
export type SourceConstraint =
  | KeyConstraint
  | UniqueConstraint
  | ForeignKeyConstraint
  | CheckConstraint

/** Named schema constraints attached to a source. */
export type SourceConstraintsRecord = Readonly<Record<string, SourceConstraint>>

/**
 * Validate one constraint against a schema adapter dialect. This is kept
 * separate from construction because the same declaration can be inspected
 * for more than one target dialect before a serializer is selected.
 */
export function validateConstraintDialect(
  constraint: SourceConstraint,
  dialect: string,
  path: readonly (string | number)[] = ['constraint']
) {
  const diagnostics = [] as import('./metadata.ts').SchemaMetadataDiagnostic[]
  const extension = constraint.dialect
  if (extension !== undefined) {
    const mismatch = dialectMismatchDiagnostic(extension, dialect, [
      ...path,
      'dialect',
    ])
    if (mismatch !== undefined) diagnostics.push(mismatch)

    if (
      extension.dialect === 'postgresql' &&
      'notValid' in extension &&
      extension.notValid === true &&
      (constraint.kind === 'primary-key' ||
        constraint.kind === 'unique' ||
        constraint.kind === 'unique-constraint')
    ) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message: 'PostgreSQL NOT VALID is not supported for key constraints',
        path: [...path, 'dialect', 'notValid'],
        dialect,
      })
    }

    if (
      extension.dialect === 'sqlite' &&
      'onConflict' in extension &&
      extension.onConflict !== undefined &&
      constraint.kind === 'foreign-key'
    ) {
      diagnostics.push({
        code: 'unsupported-dialect-option',
        message: 'SQLite conflict policies do not apply to foreign keys',
        path: [...path, 'dialect', 'onConflict'],
        dialect,
      })
    }
  }

  if (
    constraint.kind === 'foreign-key' &&
    constraint.match === 'partial' &&
    dialect === 'mysql'
  ) {
    diagnostics.push({
      code: 'unsupported-dialect-option',
      message: 'MySQL does not support MATCH PARTIAL foreign keys',
      path: [...path, 'match'],
      dialect,
    })
  }
  if (
    constraint.kind === 'foreign-key' &&
    constraint.deferrable === true &&
    dialect === 'mysql'
  ) {
    diagnostics.push({
      code: 'unsupported-dialect-option',
      message: 'MySQL foreign keys cannot be declared DEFERRABLE',
      path: [...path, 'deferrable'],
      dialect,
    })
  }
  if (constraint.initially !== undefined && constraint.deferrable !== true) {
    diagnostics.push({
      code: 'unsupported-dialect-option',
      message: 'An initial constraint timing requires deferrable: true',
      path: [...path, 'initially'],
      dialect,
    })
  }

  return Object.freeze(diagnostics)
}

export type AnyKeyColumn = ColumnReference<string, any>

type ColumnSource<TColumn> =
  DependenciesOf<TColumn> extends ColumnDependency<infer TSource, string>
    ? TSource
    : never

type IsNullableKeyColumn<TColumn> = [
  DeclaredColumnNullabilityOf<TColumn>,
] extends [never]
  ? null extends OutputOf<TColumn>
    ? true
    : false
  : true extends DeclaredColumnNullabilityOf<TColumn>
    ? true
    : false

type InvalidKeyColumn<TColumn, TSource> = TColumn extends AnyKeyColumn
  ? IsNullableKeyColumn<TColumn> extends true
    ? TColumn
    : DependenciesOf<TColumn> extends ColumnDependency<TSource, string>
      ? never
      : TColumn
  : TColumn

type KeyColumnsValidation<TColumns extends readonly AnyKeyColumn[]> = [
  {
    [K in keyof TColumns]: InvalidKeyColumn<
      TColumns[K],
      ColumnSource<TColumns[0]>
    >
  }[number],
] extends [never]
  ? unknown
  : never

type SameSourceColumnsValidation<TColumns extends readonly AnyKeyColumn[]> = [
  {
    [K in keyof TColumns]: TColumns[K] extends AnyKeyColumn
      ? DependenciesOf<TColumns[K]> extends ColumnDependency<
          ColumnSource<TColumns[0]>,
          string
        >
        ? never
        : TColumns[K]
      : TColumns[K]
  }[number],
] extends [never]
  ? unknown
  : never

type SameSqlDomain<TLeft, TRight> =
  SqlTypeOf<TLeft> extends infer TLeftSql
    ? SqlTypeOf<TRight> extends infer TRightSql
      ? TLeftSql extends SqlUnknown
        ? false
        : TRightSql extends SqlUnknown
          ? false
          : TLeftSql extends AnySqlType
            ? TRightSql extends AnySqlType
              ? string extends TLeftSql['sqlType']
                ? false
                : string extends TRightSql['sqlType']
                  ? false
                  : [TLeftSql['sqlType']] extends [TRightSql['sqlType']]
                    ? [TRightSql['sqlType']] extends [TLeftSql['sqlType']]
                      ? true
                      : false
                    : false
              : false
            : false
      : false
    : false

type ForeignKeyColumnsValidation<
  TLocal extends readonly AnyKeyColumn[],
  TTarget extends readonly AnyKeyColumn[],
> = TLocal extends readonly [infer TLocalHead, ...infer TLocalTail]
  ? TTarget extends readonly [infer TTargetHead, ...infer TTargetTail]
    ? TLocalHead extends AnyKeyColumn
      ? TTargetHead extends AnyKeyColumn
        ? SameSqlDomain<TLocalHead, TTargetHead> extends true
          ? ForeignKeyColumnsValidation<
              Extract<TLocalTail, readonly AnyKeyColumn[]>,
              Extract<TTargetTail, readonly AnyKeyColumn[]>
            >
          : never
        : never
      : never
    : never
  : TTarget extends readonly []
    ? unknown
    : never

type IsUnresolvedSqlDomain<TSqlType> = TSqlType extends SqlUnknown
  ? true
  : TSqlType extends AnySqlType
    ? string extends TSqlType['sqlType']
      ? true
      : false
    : true

type CatalogSqlDomainCompatible<TLeft, TRight> = true extends
  | IsUnresolvedSqlDomain<SqlTypeOf<TLeft>>
  | IsUnresolvedSqlDomain<SqlTypeOf<TRight>>
  ? true
  : SameSqlDomain<TLeft, TRight>

type CatalogForeignKeyColumnsValidation<
  TLocal extends readonly AnyKeyColumn[],
  TTarget extends readonly AnyKeyColumn[],
> = TLocal extends readonly [infer TLocalHead, ...infer TLocalTail]
  ? TTarget extends readonly [infer TTargetHead, ...infer TTargetTail]
    ? TLocalHead extends AnyKeyColumn
      ? TTargetHead extends AnyKeyColumn
        ? CatalogSqlDomainCompatible<TLocalHead, TTargetHead> extends true
          ? CatalogForeignKeyColumnsValidation<
              Extract<TLocalTail, readonly AnyKeyColumn[]>,
              Extract<TTargetTail, readonly AnyKeyColumn[]>
            >
          : never
        : never
      : never
    : never
  : TTarget extends readonly []
    ? unknown
    : never

type CheckExpressionValidation<TExpression> = [SqlTypeOf<TExpression>] extends [
  never,
]
  ? never
  : SqlTypeOf<TExpression> extends SqlBoolean
    ? unknown
    : never

/** Declare a primary key, including a composite primary key. */
export function primaryKey<
  const TColumns extends readonly [AnyKeyColumn, ...AnyKeyColumn[]],
>(
  ...columns: TColumns & KeyColumnsValidation<NoInfer<TColumns>>
): KeyConstraint<'primary-key', TColumns>
export function primaryKey<
  const TColumns extends readonly [AnyKeyColumn, ...AnyKeyColumn[]],
  const TOptions extends KeyConstraintOptions,
>(
  ...columnsAndOptions: [...TColumns, TOptions] &
    KeyColumnsValidation<NoInfer<TColumns>>
): KeyConstraint<'primary-key', TColumns>
export function primaryKey(...columnsAndOptions: readonly unknown[]) {
  const last = columnsAndOptions.at(-1)
  const options =
    last && typeof last === 'object' && !('expressionKind' in last)
      ? last
      : undefined
  const columns = (
    options ? columnsAndOptions.slice(0, -1) : columnsAndOptions
  ) as readonly AnyKeyColumn[]
  return freezeConstraint(
    'primary-key',
    columns,
    options as KeyConstraintOptions | undefined
  )
}

/** Declare a non-null unique key, including a composite unique key. */
export function unique<
  const TColumns extends readonly [AnyKeyColumn, ...AnyKeyColumn[]],
>(
  ...columns: TColumns & KeyColumnsValidation<NoInfer<TColumns>>
): KeyConstraint<'unique', TColumns>
export function unique<
  const TColumns extends readonly [AnyKeyColumn, ...AnyKeyColumn[]],
  const TOptions extends KeyConstraintOptions,
>(
  ...columnsAndOptions: [...TColumns, TOptions] &
    KeyColumnsValidation<NoInfer<TColumns>>
): KeyConstraint<'unique', TColumns>
export function unique(...columnsAndOptions: readonly unknown[]) {
  const last = columnsAndOptions.at(-1)
  const options =
    last && typeof last === 'object' && !('expressionKind' in last)
      ? last
      : undefined
  const columns = (
    options ? columnsAndOptions.slice(0, -1) : columnsAndOptions
  ) as readonly AnyKeyColumn[]
  return freezeConstraint(
    'unique',
    columns,
    options as KeyConstraintOptions | undefined
  )
}

/**
 * Describe database uniqueness without claiming that the columns determine a
 * row. Nullable columns are accepted, and the NULL behavior is explicit in
 * the returned metadata. Use {@link unique} when a type-level key proof is
 * intended.
 */
export function uniqueConstraint<
  const TColumns extends readonly [AnyKeyColumn, ...AnyKeyColumn[]],
>(
  ...columns: TColumns & SameSourceColumnsValidation<NoInfer<TColumns>>
): UniqueConstraint<TColumns, 'distinct'>
export function uniqueConstraint<
  const TColumns extends readonly [AnyKeyColumn, ...AnyKeyColumn[]],
  const TOptions extends UniqueConstraintOptions,
>(
  ...columnsAndOptions: [...TColumns, TOptions] &
    SameSourceColumnsValidation<NoInfer<TColumns>>
): UniqueConstraint<
  TColumns,
  TOptions extends { readonly nulls: infer TNulls extends UniqueNullSemantics }
    ? TNulls
    : 'distinct'
>
export function uniqueConstraint(...columnsAndOptions: readonly unknown[]) {
  const last = columnsAndOptions.at(-1)
  const options =
    last && typeof last === 'object' && !('expressionKind' in last)
      ? last
      : undefined
  const columns = (
    options ? columnsAndOptions.slice(0, -1) : columnsAndOptions
  ) as readonly AnyKeyColumn[]
  const resolvedOptions = (options ?? {}) as UniqueConstraintOptions
  return freezeConstraint(
    'unique-constraint',
    columns,
    resolvedOptions,
    resolvedOptions.nulls ?? 'distinct'
  )
}

/** Pair a table with the exact columns targeted by a foreign key. */
export function references<
  TTable extends TableLike<any>,
  const TColumns extends readonly [AnyKeyColumn, ...AnyKeyColumn[]],
>(table: TTable, ...columns: TColumns): ForeignKeyTarget<TTable, TColumns> {
  return Object.freeze({
    table,
    columns: Object.freeze([...columns]) as unknown as TColumns,
  })
}

type ResolvedTarget<T> = T extends () => infer TResolved ? TResolved : T

/** Declare a single-column or composite foreign key. */
export function foreignKey<
  const TColumns extends readonly [AnyKeyColumn, ...AnyKeyColumn[]],
  const TTarget extends ForeignKeyTargetInput,
  const TOptions extends ForeignKeyOptions = {},
>(
  columns: TColumns & SameSourceColumnsValidation<NoInfer<TColumns>>,
  target: TTarget &
    (ResolvedTarget<TTarget> extends ForeignKeyTarget<any, infer TTargetColumns>
      ? ForeignKeyColumnsValidation<TColumns, TTargetColumns>
      : never),
  options?: TOptions
): ForeignKeyConstraint<TColumns, TTarget> {
  return freezeConstraint(
    'foreign-key',
    columns,
    options,
    target
  ) as ForeignKeyConstraint<TColumns, TTarget>
}

/**
 * Reconstruct a foreign key proved by database catalog metadata.
 *
 * @remarks
 * Use this helper for generated or introspection-owned declarations when one
 * or both native SQL domains are unresolved. It accepts unresolved domains,
 * but still rejects known domain mismatches, unequal tuple arity, and local
 * columns from different sources. The enclosing `table()` declaration
 * continues to verify target-column ownership and candidate-key metadata.
 * Resolved targets also receive runtime shape, ownership, and arity checks.
 * The returned value serializes as an ordinary foreign-key constraint.
 */
export function catalogForeignKey<
  const TColumns extends readonly [AnyKeyColumn, ...AnyKeyColumn[]],
  const TTarget extends ForeignKeyTargetInput,
  const TOptions extends ForeignKeyOptions = {},
>(
  columns: TColumns & SameSourceColumnsValidation<NoInfer<TColumns>>,
  target: TTarget &
    (ResolvedTarget<TTarget> extends ForeignKeyTarget<any, infer TTargetColumns>
      ? CatalogForeignKeyColumnsValidation<TColumns, TTargetColumns>
      : never),
  options?: TOptions
): ForeignKeyConstraint<TColumns, TTarget> {
  assertCatalogForeignKeyColumns(columns, 'local')
  const validatedTarget = validateCatalogForeignKeyTargetInput(
    target,
    columns.length
  ) as TTarget

  return freezeConstraint(
    'foreign-key',
    columns,
    options,
    validatedTarget
  ) as ForeignKeyConstraint<TColumns, TTarget>
}

/** Declare a boolean table invariant. */
export function check<
  const TExpression extends Expression<any, any>,
  const TOptions extends CheckConstraintOptions = {},
>(
  expression: TExpression & CheckExpressionValidation<TExpression>,
  options?: TOptions
): CheckConstraint<TExpression> {
  return freezeConstraint(
    'check',
    undefined,
    options,
    expression
  ) as CheckConstraint<TExpression>
}

/**
 * Reconstruct a boolean check from opaque SQL recovered from a database
 * catalog.
 *
 * @remarks
 * This helper records catalog origin as a narrow type-level proof. It
 * gives the opaque expression the {@link SqlBoolean} semantic type without
 * changing the ordinary {@link check} contract. Qubu does not parse or infer
 * dependencies from the SQL. It preserves the text apart from normalizing
 * line endings and retains the dialect tag in serialized schema metadata.
 */
export function catalogCheck<
  const TDialect extends SchemaDialectName,
  const TOptions extends CheckConstraintOptions = {},
>(
  input: CatalogCheckSql<TDialect>,
  options?: TOptions
): CheckConstraint<CatalogCheckExpression<TDialect>> {
  assertCatalogCheckSql(input)
  const expression = unsafeSchemaSql(
    input.dialect,
    input.sql
  ) as CatalogCheckExpression<TDialect>

  return freezeConstraint(
    'check',
    undefined,
    options,
    expression
  ) as CheckConstraint<CatalogCheckExpression<TDialect>>
}

function assertCatalogCheckSql(
  value: unknown
): asserts value is CatalogCheckSql {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('catalogCheck() requires dialect-tagged SQL data')
  }

  const input = value as Partial<CatalogCheckSql>
  if (
    input.dialect !== 'postgresql' &&
    input.dialect !== 'sqlite' &&
    input.dialect !== 'mysql'
  ) {
    throw new TypeError(
      `catalogCheck() requires a supported catalog dialect, received "${String(input.dialect)}"`
    )
  }
  if (typeof input.sql !== 'string' || input.sql.trim().length === 0) {
    throw new TypeError('catalogCheck() requires non-empty SQL text')
  }
}

function assertCatalogForeignKeyColumns(
  value: unknown,
  side: 'local' | 'target'
): asserts value is readonly [AnyKeyColumn, ...AnyKeyColumn[]] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(
      `catalogForeignKey() requires at least one ${side} column`
    )
  }
  if (!value.every(isColumnReference)) {
    throw new TypeError(
      `catalogForeignKey() requires ${side} columns to be column references`
    )
  }
}

function validateCatalogForeignKeyTargetInput(
  value: ForeignKeyTargetInput,
  localArity: number
): ForeignKeyTargetInput {
  return typeof value === 'function'
    ? () => validateCatalogForeignKeyTarget(value(), localArity)
    : validateCatalogForeignKeyTarget(value, localArity)
}

function validateCatalogForeignKeyTarget(
  value: unknown,
  localArity: number
): ForeignKeyTarget {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('catalogForeignKey() requires a foreign-key target')
  }

  const target = value as Partial<ForeignKeyTarget>
  assertCatalogForeignKeyColumns(target.columns, 'target')
  if (target.columns.length !== localArity) {
    throw new TypeError(
      `catalogForeignKey() column arity differs: ${localArity} local and ${target.columns.length} target`
    )
  }

  const table = target.table as Partial<TableLike<any>> | undefined
  if (
    typeof table !== 'object' ||
    table === null ||
    typeof table.columns !== 'object' ||
    table.columns === null
  ) {
    throw new TypeError('catalogForeignKey() target must reference a table')
  }
  for (const column of target.columns) {
    if (table.columns[column.fieldName] !== column) {
      throw new TypeError(
        `catalogForeignKey() target column "${column.fieldName}" does not belong to its table`
      )
    }
  }

  return target as ForeignKeyTarget
}

function freezeConstraint(
  kind:
    | 'primary-key'
    | 'unique'
    | 'unique-constraint'
    | 'foreign-key'
    | 'check',
  columns: readonly AnyKeyColumn[] | undefined,
  options:
    | ConstraintOptions
    | ForeignKeyOptions
    | UniqueConstraintOptions
    | KeyConstraintOptions
    | CheckConstraintOptions
    | undefined,
  extra?: unknown
): object {
  const value: Record<string, unknown> = { kind }
  const optionValues = options as
    | (ConstraintOptions & {
        readonly deferrable?: boolean
        readonly initially?: ConstraintTiming
        readonly onUpdate?: ReferentialAction
        readonly onDelete?: ReferentialAction
        readonly match?: ForeignKeyMatch
      })
    | undefined
  if (columns !== undefined) value.columns = Object.freeze([...columns])

  if (kind === 'check') value.expression = extra
  else if (kind === 'foreign-key') value.target = extra
  else if (kind === 'unique-constraint') value.nulls = extra

  if (optionValues?.physicalName !== undefined) {
    value.physicalName = optionValues.physicalName
  }
  if (optionValues?.dialect !== undefined) {
    value.dialect = freezeSchemaMetadata(optionValues.dialect)
  }
  if (optionValues?.deferrable !== undefined) {
    value.deferrable = optionValues.deferrable
  }
  if (optionValues?.initially !== undefined) {
    value.initially = optionValues.initially
  }
  if (kind === 'foreign-key') {
    if (optionValues?.onUpdate !== undefined) {
      value.onUpdate = optionValues.onUpdate
    }
    if (optionValues?.onDelete !== undefined) {
      value.onDelete = optionValues.onDelete
    }
    if (optionValues?.match !== undefined) {
      value.match = optionValues.match
    }
  }
  return Object.freeze(value)
}
