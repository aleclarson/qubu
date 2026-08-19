import type {
  ExpressionMeta,
  Fragment,
  RequiresSourceMeta,
  ResultMeta,
} from '../core/fragment.ts'
import type { AnySqlType, SqlUnknown } from '../core/sql-types.ts'
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
  TColumns extends readonly string[] = readonly string[],
> {
  readonly kind: TKind
  readonly columns: TColumns
}

/** Structured schema metadata carried by sources that declare constraints. */
export type SourceConstraint = KeyConstraint

/** Declare a primary key, including a composite primary key. */
export function primaryKey<
  const TColumns extends readonly [string, ...string[]],
>(...columns: TColumns): KeyConstraint<'primary-key', TColumns> {
  return Object.freeze({ kind: 'primary-key', columns })
}

/** Declare a non-null unique key, including a composite unique key. */
export function unique<const TColumns extends readonly [string, ...string[]]>(
  ...columns: TColumns
): KeyConstraint<'unique', TColumns> {
  return Object.freeze({ kind: 'unique', columns })
}
