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
    TGenerated
  >
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
> = ColumnDefinition<
  TOutput,
  Flag<TOptions['nullable']>,
  TInsert,
  TUpdate,
  Flag<TOptions['hasDefault']>,
  Flag<TOptions['generated']>
>

export type ColumnOutput<T> =
  T extends ColumnDefinition<infer TOutput, infer TNullable, any, any, any, any>
    ? TNullable extends true
      ? TOutput | null
      : TOutput
    : never

export type ColumnInsertInput<T> =
  T extends ColumnDefinition<any, infer TNullable, infer TInsert, any, any, any>
    ? TNullable extends true
      ? TInsert | null
      : TInsert
    : never

export type ColumnUpdateInput<T> =
  T extends ColumnDefinition<any, infer TNullable, any, infer TUpdate, any, any>
    ? TNullable extends true
      ? TUpdate | null
      : TUpdate
    : never

export type ColumnHasDefault<T> =
  T extends ColumnDefinition<any, any, any, any, infer THasDefault, any>
    ? THasDefault
    : false

export type ColumnIsGenerated<T> =
  T extends ColumnDefinition<any, any, any, any, any, infer TGenerated>
    ? TGenerated
    : false

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
>(options: {
  readonly nullable: true
  readonly hasDefault: true
  readonly generated: true
  readonly sqlName?: string
}): ColumnDefinition<TOutput, true, TInsert, TUpdate, true, true>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
>(options: {
  readonly nullable: true
  readonly hasDefault: true
  readonly generated?: false
  readonly sqlName?: string
}): ColumnDefinition<TOutput, true, TInsert, TUpdate, true, false>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
>(options: {
  readonly nullable: true
  readonly hasDefault?: false
  readonly generated: true
  readonly sqlName?: string
}): ColumnDefinition<TOutput, true, TInsert, TUpdate, false, true>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
>(options: {
  readonly nullable: true
  readonly hasDefault?: false
  readonly generated?: false
  readonly sqlName?: string
}): ColumnDefinition<TOutput, true, TInsert, TUpdate, false, false>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
>(options: {
  readonly nullable?: false
  readonly hasDefault: true
  readonly generated: true
  readonly sqlName?: string
}): ColumnDefinition<TOutput, false, TInsert, TUpdate, true, true>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
>(options: {
  readonly nullable?: false
  readonly hasDefault: true
  readonly generated?: false
  readonly sqlName?: string
}): ColumnDefinition<TOutput, false, TInsert, TUpdate, true, false>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
>(options: {
  readonly nullable?: false
  readonly hasDefault?: false
  readonly generated: true
  readonly sqlName?: string
}): ColumnDefinition<TOutput, false, TInsert, TUpdate, false, true>
export function column<TOutput = unknown, TInsert = TOutput, TUpdate = TInsert>(
  options?: FalseColumnOptions
): ColumnDefinition<TOutput, false, TInsert, TUpdate, false, false>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  const TOptions extends ColumnOptions = {},
>(options?: TOptions): ColumnFromOptions<TOutput, TInsert, TUpdate, TOptions>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  const TOptions extends ColumnOptions = {},
>(options?: TOptions) {
  return Object.freeze({
    definitionKind: 'column' as const,
    nullable: options?.nullable === true,
    hasDefault: options?.hasDefault === true,
    generated: options?.generated === true,
    sqlName: options?.sqlName,
    $type: narrowColumnType,
  }) as ColumnFromOptions<TOutput, TInsert, TUpdate, TOptions>
}

export function nullable<
  TOutput,
  TNullable extends boolean,
  TInsert,
  TUpdate,
  THasDefault extends boolean,
  TGenerated extends boolean,
>(
  definition: ColumnDefinition<
    TOutput,
    TNullable,
    TInsert,
    TUpdate,
    THasDefault,
    TGenerated
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
    TGenerated
  >
}

export function integer<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<number, number, number, TOptions>(options)
}

export function numeric<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<number, number, number, TOptions>(options)
}

export function text<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<string, string, string, TOptions>(options)
}

export function boolean<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<boolean, boolean, boolean, TOptions>(options)
}

export function date<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<Date, Date, Date, TOptions>(options)
}

export function timestamp<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<Date, Date, Date, TOptions>(options)
}

/** Alias for timestamp columns whose application name emphasizes date-time. */
export const dateTime = timestamp

export function uuid<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<string, string, string, TOptions>(options)
}

export function json<
  TOutput = unknown,
  const TOptions extends ColumnOptions = {},
>(options?: TOptions) {
  return column<TOutput, TOutput, TOutput, TOptions>(options)
}

export function bigint<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<bigint, bigint, bigint, TOptions>(options)
}

export function binary<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
) {
  return column<Uint8Array, Uint8Array, Uint8Array, TOptions>(options)
}

/** Common driver-neutral name for a binary/blob column. */
export const blob = binary
