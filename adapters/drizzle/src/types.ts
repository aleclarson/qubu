import type {
  ColumnHasDefault,
  ColumnIdentityOf,
  ColumnInsertInput,
  ColumnIsGenerated,
  ColumnOutput,
  ColumnStorageOf,
  ColumnUpdateInput,
  NativeColumnStorage,
  PortableColumnStorage,
  SchemaTableRecord,
} from "qubu"

/** SQL engines supported by the Qubu-to-Drizzle runtime adapter. */
export type DrizzleDialect = "postgresql" | "mysql" | "sqlite"

type IsAny<T> = 0 extends 1 & T ? true : false

type SameType<TLeft, TRight> =
  IsAny<TLeft> extends true
    ? true
    : IsAny<TRight> extends true
      ? true
      : (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
        ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
          ? true
          : false
        : false

type HasCompatibleValueTypes<TDefinition> =
  SameType<ColumnOutput<TDefinition>, ColumnInsertInput<TDefinition>> extends true
    ? SameType<ColumnOutput<TDefinition>, ColumnUpdateInput<TDefinition>>
    : false

type HasCompatibleStorage<TDefinition, TDialect extends DrizzleDialect> =
  ColumnStorageOf<TDefinition> extends infer TStorage
    ? TStorage extends PortableColumnStorage
      ? true
      : TStorage extends NativeColumnStorage<infer TStorageDialect, string>
        ? TDialect extends TStorageDialect
          ? true
          : false
        : false
    : false

type InvalidValueTypeColumns<TTables extends SchemaTableRecord> = {
  [TTableKey in keyof TTables & string]: {
    [TColumnKey in keyof TTables[TTableKey]["definitions"] & string]: HasCompatibleValueTypes<
      TTables[TTableKey]["definitions"][TColumnKey]
    > extends true
      ? never
      : `${TTableKey}.${TColumnKey}`
  }[keyof TTables[TTableKey]["definitions"] & string]
}[keyof TTables & string]

type InvalidStorageColumns<TTables extends SchemaTableRecord, TDialect extends DrizzleDialect> = {
  [TTableKey in keyof TTables & string]: {
    [TColumnKey in keyof TTables[TTableKey]["definitions"] & string]: HasCompatibleStorage<
      TTables[TTableKey]["definitions"][TColumnKey],
      TDialect
    > extends true
      ? never
      : `${TTableKey}.${TColumnKey}`
  }[keyof TTables[TTableKey]["definitions"] & string]
}[keyof TTables & string]

export type DrizzleSchemaValidation<
  TTables extends SchemaTableRecord,
  TDialect extends DrizzleDialect,
> = ([InvalidValueTypeColumns<TTables>] extends [never]
  ? unknown
  : {
      readonly __drizzle_requires_one_value_type__: InvalidValueTypeColumns<TTables>
    }) &
  ([InvalidStorageColumns<TTables, TDialect>] extends [never]
    ? unknown
    : {
        readonly __drizzle_requires_compatible_storage__: InvalidStorageColumns<TTables, TDialect>
      })

type DrizzleColumnIdentity<TDefinition> =
  ColumnIdentityOf<TDefinition> extends {
    readonly generation: infer TGeneration
  }
    ? TGeneration extends "always"
      ? "always"
      : TGeneration extends "by-default"
        ? "byDefault"
        : undefined
    : undefined

type DrizzleColumnGenerated<TDefinition> =
  ColumnIsGenerated<TDefinition> extends true
    ? {
        readonly as: ColumnOutput<TDefinition>
        readonly type: "always"
      }
    : undefined

type DrizzleColumnHasDefault<TDefinition> =
  ColumnIsGenerated<TDefinition> extends true ? true : ColumnHasDefault<TDefinition>

export type DrizzleColumnConfig<TTableName extends string, TDefinition> = {
  readonly name: string
  readonly tableName: TTableName
  readonly dataType: "custom"
  readonly data: ColumnOutput<TDefinition>
  readonly driverParam: ColumnInsertInput<TDefinition>
  readonly enumValues: undefined
  /**
   * Qubu makes nullable columns required on insert unless they have a default. Keeping this flag
   * true and carrying null in `data` preserves that rule in Drizzle's single-axis column model.
   */
  readonly notNull: true
  readonly hasDefault: DrizzleColumnHasDefault<TDefinition>
  readonly isPrimaryKey: false
  readonly isAutoincrement: false
  readonly hasRuntimeDefault: false
  readonly identity: DrizzleColumnIdentity<TDefinition>
  readonly generated: DrizzleColumnGenerated<TDefinition>
}
