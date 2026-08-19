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
import type { AnyExpression, Expression } from '../expressions/types.ts'
import type {
  ColumnDependency,
  ColumnReference,
} from '../expressions/column.ts'
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

/** A schema constraint whose columns form a relational key. */
export interface KeyConstraint<
  TKind extends 'primary-key' | 'unique' = 'primary-key' | 'unique',
  TColumns extends readonly ColumnReference<
    string,
    any
  >[] = readonly ColumnReference<string, any>[],
> {
  readonly kind: TKind
  readonly columns: TColumns
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
> {
  readonly kind: 'foreign-key'
  readonly columns: TColumns
  readonly target: TTarget
}

/** A table-scoped boolean invariant. */
export interface CheckConstraint<
  TExpression extends AnyExpression = AnyExpression,
> {
  readonly kind: 'check'
  readonly expression: TExpression
}

/** Structured schema metadata carried by sources that declare constraints. */
export type SourceConstraint =
  | KeyConstraint
  | ForeignKeyConstraint
  | CheckConstraint

/** Named schema constraints attached to a source. */
export type SourceConstraintsRecord = Readonly<Record<string, SourceConstraint>>

export type AnyKeyColumn = ColumnReference<string, any>

type ColumnSource<TColumn> =
  DependenciesOf<TColumn> extends ColumnDependency<infer TSource, string>
    ? TSource
    : never

type InvalidKeyColumn<TColumn, TSource> = TColumn extends AnyKeyColumn
  ? null extends OutputOf<TColumn>
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

/** Declare a primary key, including a composite primary key. */
export function primaryKey<
  const TColumns extends readonly [AnyKeyColumn, ...AnyKeyColumn[]],
>(
  ...columns: TColumns & KeyColumnsValidation<NoInfer<TColumns>>
): KeyConstraint<'primary-key', TColumns> {
  return Object.freeze({ kind: 'primary-key', columns })
}

/** Declare a non-null unique key, including a composite unique key. */
export function unique<
  const TColumns extends readonly [AnyKeyColumn, ...AnyKeyColumn[]],
>(
  ...columns: TColumns & KeyColumnsValidation<NoInfer<TColumns>>
): KeyConstraint<'unique', TColumns> {
  return Object.freeze({ kind: 'unique', columns })
}

/** Pair a table with the exact columns targeted by a foreign key. */
export function references<
  TTable extends TableLike<any>,
  const TColumns extends readonly [AnyKeyColumn, ...AnyKeyColumn[]],
>(table: TTable, ...columns: TColumns): ForeignKeyTarget<TTable, TColumns> {
  return Object.freeze({ table, columns })
}

type ResolvedTarget<T> = T extends () => infer TResolved ? TResolved : T

/** Declare a single-column or composite foreign key. */
export function foreignKey<
  const TColumns extends readonly [AnyKeyColumn, ...AnyKeyColumn[]],
  const TTarget extends ForeignKeyTargetInput,
>(
  columns: TColumns & SameSourceColumnsValidation<NoInfer<TColumns>>,
  target: TTarget &
    (ResolvedTarget<TTarget> extends ForeignKeyTarget<any, infer TTargetColumns>
      ? ForeignKeyColumnsValidation<TColumns, TTargetColumns>
      : never)
): ForeignKeyConstraint<TColumns, TTarget> {
  return Object.freeze({ kind: 'foreign-key', columns, target })
}

/** Declare a boolean table invariant. */
export function check<const TExpression extends Expression<any, any>>(
  expression: TExpression &
    (SqlTypeOf<TExpression> extends SqlBoolean ? unknown : never)
): CheckConstraint<TExpression> {
  return Object.freeze({ kind: 'check', expression })
}
