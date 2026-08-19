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

export interface FieldLikeOptions {
  readonly output?: unknown
  readonly sqlType?: object
  readonly nullable?: boolean
}

/** A reusable source-field requirement combining JS and SQL-level facts. */
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

/** A source containing at least the requested application and SQL fields. */
export interface SourceLike<TShape extends object> extends Fragment<any> {
  readonly sourceKind: SourceKind
  readonly [sourceIdentity]: unknown
  readonly reference: Fragment<never>
  readonly columns: RequiredColumns<TShape, this[typeof sourceIdentity]>
}

/** A physical table containing at least the requested fields. */
export interface TableLike<TShape extends object> extends SourceLike<TShape> {
  readonly tableName: string
  readonly definitions: object
  readonly sqlNames: Readonly<Record<string, string>>
}
