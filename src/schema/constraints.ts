import type { FragmentMeta, ResultMeta } from '../core/fragment.ts'
import type { AnySqlType, SqlUnknown } from '../core/sql-types.ts'
import type { ColumnReference } from '../expressions/column.ts'
import type { AnySource } from './source.ts'

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
      ? TSqlType | SqlUnknown
      : AnySqlType
    : AnySqlType

type NonResultMetadata = Exclude<
  FragmentMeta,
  ResultMeta<unknown, unknown, AnySqlType>
>

type RequiredColumn<T> = ColumnReference<
  string,
  | {
      readonly kind: 'result'
      readonly output: RequiredOutput<T>
      readonly nullableFrom: unknown
      readonly sqlType: RequiredSqlType<T>
    }
  | NonResultMetadata
>

type RequiredColumns<TShape extends object> = {
  readonly [K in keyof TShape]-?: RequiredColumn<TShape[K]>
}

/** A source containing at least the requested application and SQL fields. */
export type SourceLike<TShape extends object> = AnySource & {
  readonly columns: RequiredColumns<TShape>
}

/** A physical table containing at least the requested fields. */
export type TableLike<TShape extends object> = SourceLike<TShape> & {
  readonly tableName: string
  readonly definitions: object
  readonly sqlNames: Readonly<Record<string, string>>
}
