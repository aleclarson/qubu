export interface ColumnOptions {
  readonly nullable?: boolean
  readonly hasDefault?: boolean
  readonly generated?: boolean
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
  readonly __output?: TOutput
  readonly __insert?: TInsert
  readonly __update?: TUpdate
}

type Flag<T extends boolean | undefined> = T extends true ? true : false

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
}

export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
>(options: {
  readonly nullable: true
  readonly hasDefault: true
  readonly generated: true
}): ColumnDefinition<TOutput, true, TInsert, TUpdate, true, true>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
>(options: {
  readonly nullable: true
  readonly hasDefault: true
  readonly generated?: false
}): ColumnDefinition<TOutput, true, TInsert, TUpdate, true, false>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
>(options: {
  readonly nullable: true
  readonly hasDefault?: false
  readonly generated: true
}): ColumnDefinition<TOutput, true, TInsert, TUpdate, false, true>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
>(options: {
  readonly nullable: true
  readonly hasDefault?: false
  readonly generated?: false
}): ColumnDefinition<TOutput, true, TInsert, TUpdate, false, false>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
>(options: {
  readonly nullable?: false
  readonly hasDefault: true
  readonly generated: true
}): ColumnDefinition<TOutput, false, TInsert, TUpdate, true, true>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
>(options: {
  readonly nullable?: false
  readonly hasDefault: true
  readonly generated?: false
}): ColumnDefinition<TOutput, false, TInsert, TUpdate, true, false>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
>(options: {
  readonly nullable?: false
  readonly hasDefault?: false
  readonly generated: true
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
