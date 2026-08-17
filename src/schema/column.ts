export interface ColumnDefinition<
  TOutput = unknown,
  TNullable extends boolean = false,
> {
  readonly definitionKind: 'column'
  readonly nullable: TNullable
  readonly __output?: TOutput
}

export type ColumnOutput<T> =
  T extends ColumnDefinition<infer TOutput, infer TNullable>
    ? TNullable extends true
      ? TOutput | null
      : TOutput
    : never

export function column<TOutput = unknown>(options: {
  nullable: true
}): ColumnDefinition<TOutput, true>
export function column<TOutput = unknown>(options?: {
  nullable?: false
}): ColumnDefinition<TOutput, false>
export function column<TOutput = unknown>(
  options: { nullable?: boolean } = {}
) {
  return Object.freeze({
    definitionKind: 'column' as const,
    nullable: options.nullable === true,
  }) as ColumnDefinition<TOutput, boolean>
}

export function nullable<TOutput>(definition: ColumnDefinition<TOutput, any>) {
  return Object.freeze({
    ...definition,
    nullable: true as const,
  }) as ColumnDefinition<TOutput, true>
}

export function integer(): ColumnDefinition<number, false>
export function integer(options: {
  nullable: true
}): ColumnDefinition<number, true>
export function integer(options?: { nullable?: boolean }) {
  return options?.nullable === true
    ? column<number>({ nullable: true })
    : column<number>()
}

export function numeric(): ColumnDefinition<number, false>
export function numeric(options: {
  nullable: true
}): ColumnDefinition<number, true>
export function numeric(options?: { nullable?: boolean }) {
  return options?.nullable === true
    ? column<number>({ nullable: true })
    : column<number>()
}

export function text(): ColumnDefinition<string, false>
export function text(options: {
  nullable: true
}): ColumnDefinition<string, true>
export function text(options?: { nullable?: boolean }) {
  return options?.nullable === true
    ? column<string>({ nullable: true })
    : column<string>()
}

export function boolean(): ColumnDefinition<boolean, false>
export function boolean(options: {
  nullable: true
}): ColumnDefinition<boolean, true>
export function boolean(options?: { nullable?: boolean }) {
  return options?.nullable === true
    ? column<boolean>({ nullable: true })
    : column<boolean>()
}

export function date(): ColumnDefinition<Date, false>
export function date(options: { nullable: true }): ColumnDefinition<Date, true>
export function date(options?: { nullable?: boolean }) {
  return options?.nullable === true
    ? column<Date>({ nullable: true })
    : column<Date>()
}
