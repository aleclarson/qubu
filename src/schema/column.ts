import type {
  AnySqlType,
  SqlBigInt,
  SqlBinary,
  SqlBoolean,
  SqlDate,
  SqlDecimal,
  SqlInteger,
  SqlJson,
  SqlText,
  SqlTimestamp,
  SqlUnknown,
  SqlUuid,
} from '../core/sql-types.ts'

export interface ColumnOptions {
  readonly nullable?: boolean
  readonly hasDefault?: boolean
  readonly generated?: boolean
  /** Override the snake_case SQL identifier derived from the field name. */
  readonly sqlName?: string
}

export interface ColumnDefinition<
  TOutput = unknown,
  TNullable extends boolean = false,
  TInsert = TOutput,
  TUpdate = TInsert,
  THasDefault extends boolean = false,
  TGenerated extends boolean = false,
  TSqlType extends AnySqlType = SqlUnknown,
> {
  readonly definitionKind: 'column'
  readonly nullable: TNullable
  readonly hasDefault: THasDefault
  readonly generated: TGenerated
  readonly sqlName?: string
  readonly __output?: TOutput
  readonly __insert?: TInsert
  readonly __update?: TUpdate
  /**
   * Narrow the column's application type without changing its runtime
   * definition.
   *
   * @remarks Distinct insert or update types are preserved. This method does
   * not validate values or add a database constraint.
   */
  readonly $type: <const TType extends TOutput>() => ColumnDefinition<
    TType,
    TNullable,
    SameType<TInsert, TOutput> extends true ? TType : TInsert,
    SameType<TUpdate, TOutput> extends true ? TType : TUpdate,
    THasDefault,
    TGenerated,
    TSqlType
  >
  readonly __sqlType?: TSqlType
}

type Flag<T extends boolean | undefined> = T extends true ? true : false

type IsAny<T> = 0 extends 1 & T ? true : false

type SameType<TLeft, TRight> =
  IsAny<TLeft> extends true
    ? IsAny<TRight>
    : IsAny<TRight> extends true
      ? false
      : [TLeft] extends [TRight]
        ? [TRight] extends [TLeft]
          ? true
          : false
        : false

function narrowColumnType(this: ColumnDefinition) {
  return this
}

export type ColumnFromOptions<
  TOutput,
  TInsert,
  TUpdate,
  TOptions extends ColumnOptions,
  TSqlType extends AnySqlType = SqlUnknown,
> = ColumnDefinition<
  TOutput,
  Flag<TOptions['nullable']>,
  TInsert,
  TUpdate,
  Flag<TOptions['hasDefault']>,
  Flag<TOptions['generated']>,
  TSqlType
>

export type ColumnOutput<T> =
  T extends ColumnDefinition<
    infer TOutput,
    infer TNullable,
    any,
    any,
    any,
    any,
    any
  >
    ? TNullable extends true
      ? TOutput | null
      : TOutput
    : never

export type ColumnInsertInput<T> =
  T extends ColumnDefinition<
    any,
    infer TNullable,
    infer TInsert,
    any,
    any,
    any,
    any
  >
    ? TNullable extends true
      ? TInsert | null
      : TInsert
    : never

export type ColumnUpdateInput<T> =
  T extends ColumnDefinition<
    any,
    infer TNullable,
    any,
    infer TUpdate,
    any,
    any,
    any
  >
    ? TNullable extends true
      ? TUpdate | null
      : TUpdate
    : never

export type ColumnHasDefault<T> =
  T extends ColumnDefinition<any, any, any, any, infer THasDefault, any, any>
    ? THasDefault
    : false

export type ColumnIsGenerated<T> =
  T extends ColumnDefinition<any, any, any, any, any, infer TGenerated, any>
    ? TGenerated
    : false

export type ColumnSqlType<T> =
  T extends ColumnDefinition<any, any, any, any, any, any, infer TSqlType>
    ? TSqlType
    : SqlUnknown

type FalseColumnOptions = {
  readonly nullable?: false
  readonly hasDefault?: false
  readonly generated?: false
  readonly sqlName?: string
}

export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
>(options: {
  readonly nullable: true
  readonly hasDefault: true
  readonly generated: true
  readonly sqlName?: string
}): ColumnDefinition<TOutput, true, TInsert, TUpdate, true, true, TSqlType>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
>(options: {
  readonly nullable: true
  readonly hasDefault: true
  readonly generated?: false
  readonly sqlName?: string
}): ColumnDefinition<TOutput, true, TInsert, TUpdate, true, false, TSqlType>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
>(options: {
  readonly nullable: true
  readonly hasDefault?: false
  readonly generated: true
  readonly sqlName?: string
}): ColumnDefinition<TOutput, true, TInsert, TUpdate, false, true, TSqlType>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
>(options: {
  readonly nullable: true
  readonly hasDefault?: false
  readonly generated?: false
  readonly sqlName?: string
}): ColumnDefinition<TOutput, true, TInsert, TUpdate, false, false, TSqlType>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
>(options: {
  readonly nullable?: false
  readonly hasDefault: true
  readonly generated: true
  readonly sqlName?: string
}): ColumnDefinition<TOutput, false, TInsert, TUpdate, true, true, TSqlType>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
>(options: {
  readonly nullable?: false
  readonly hasDefault: true
  readonly generated?: false
  readonly sqlName?: string
}): ColumnDefinition<TOutput, false, TInsert, TUpdate, true, false, TSqlType>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
>(options: {
  readonly nullable?: false
  readonly hasDefault?: false
  readonly generated: true
  readonly sqlName?: string
}): ColumnDefinition<TOutput, false, TInsert, TUpdate, false, true, TSqlType>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
>(
  options?: FalseColumnOptions
): ColumnDefinition<TOutput, false, TInsert, TUpdate, false, false, TSqlType>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  const TOptions extends ColumnOptions = {},
  TSqlType extends AnySqlType = SqlUnknown,
>(
  options?: TOptions
): ColumnFromOptions<TOutput, TInsert, TUpdate, TOptions, TSqlType>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  const TOptions extends ColumnOptions = {},
  TSqlType extends AnySqlType = SqlUnknown,
>(options?: TOptions) {
  return Object.freeze({
    definitionKind: 'column' as const,
    nullable: options?.nullable === true,
    hasDefault: options?.hasDefault === true,
    generated: options?.generated === true,
    sqlName: options?.sqlName,
    $type: narrowColumnType,
  }) as unknown as ColumnFromOptions<
    TOutput,
    TInsert,
    TUpdate,
    TOptions,
    TSqlType
  >
}

export function nullable<
  TOutput,
  TNullable extends boolean,
  TInsert,
  TUpdate,
  THasDefault extends boolean,
  TGenerated extends boolean,
  TSqlType extends AnySqlType,
>(
  definition: ColumnDefinition<
    TOutput,
    TNullable,
    TInsert,
    TUpdate,
    THasDefault,
    TGenerated,
    TSqlType
  >
) {
  return Object.freeze({
    ...definition,
    nullable: true as const,
  }) as ColumnDefinition<
    TOutput,
    true,
    TInsert,
    TUpdate,
    THasDefault,
    TGenerated,
    TSqlType
  >
}

export function integer<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<number, number, number, TOptions, SqlInteger>(options)
}

export function numeric<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<number, number, number, TOptions, SqlDecimal>(options)
}

export function text<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<string, string, string, TOptions, SqlText>(options)
}

export function boolean<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<boolean, boolean, boolean, TOptions, SqlBoolean>(options)
}

export function date<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<Date, Date, Date, TOptions, SqlDate>(options)
}

export function timestamp<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<Date, Date, Date, TOptions, SqlTimestamp>(options)
}

/** Alias for timestamp columns whose application name emphasizes date-time. */
export const dateTime = timestamp

export function uuid<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<string, string, string, TOptions, SqlUuid>(options)
}

export function json<
  TOutput = unknown,
  const TOptions extends ColumnOptions = {},
>(options?: TOptions) {
  return column<TOutput, TOutput, TOutput, TOptions, SqlJson<TOutput>>(options)
}

export function bigint<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<bigint, bigint, bigint, TOptions, SqlBigInt>(options)
}

export function binary<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<Uint8Array, Uint8Array, Uint8Array, TOptions, SqlBinary>(
    options
  )
}

/** Common driver-neutral name for a binary/blob column. */
export const blob = binary
