import type {
  CastTarget,
  NamedCastTarget,
  PortableCastTarget,
  PortableCastType,
} from "../core/dialect.ts"
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
  SqlTypeName,
  SqlUnknown,
  SqlUuid,
} from "../core/sql-types.ts"
import type { AnySchemaExpression } from "../expressions/types.ts"
import { resultValue, type ResultDecoder, type ResultValueMetadata } from "../result.ts"
import {
  resolveColumnBehavior,
  type ColumnDefaultInput,
  type ColumnDefault,
  type GeneratedColumnDescriptor,
  type IdentityDescriptor,
  type ExternalDefaultDescriptor,
  type ExternalGeneratedColumnDescriptor,
  type LiteralDefaultDescriptor,
  type ExpressionDefaultDescriptor,
  type SchemaLiteralValue,
} from "./column-behavior.ts"
import type { SchemaDialectExtension } from "./metadata.ts"

/** Portable physical storage spellings understood by every schema dialect. */
export type PortableStorageType =
  | "integer"
  | "numeric"
  | "text"
  | "boolean"
  | "date"
  | "timestamp"
  | "uuid"
  | "json"
  | "bigint"
  | "binary"

/** A dialect-neutral physical storage descriptor. */
export interface PortableColumnStorage<TType extends PortableStorageType = PortableStorageType> {
  readonly kind: "portable"
  /** Stable physical storage category, independent of the SQL domain. */
  readonly type: TType
}

/** A physical storage declaration owned by one SQL dialect. */
export interface NativeColumnStorage<
  TDialect extends string = string,
  TDeclaration extends string = string,
> {
  readonly kind: "native"
  /** Adapter name that owns the declaration. */
  readonly dialect: TDialect
  /** Exact dialect declaration, preserved without normalization. */
  readonly type: TDeclaration
}

/** Physical storage metadata carried by a column definition. */
export type ColumnStorage = PortableColumnStorage | NativeColumnStorage

/** Alias for callers that prefer the descriptor terminology. */
export type StorageDescriptor = ColumnStorage
/** Alias for the complete column storage union. */
export type ColumnStorageDescriptor = ColumnStorage
/** Alias for the dialect-owned branch of {@link ColumnStorage}. */
export type DialectNativeStorage<
  TDialect extends string = string,
  TDeclaration extends string = string,
> = NativeColumnStorage<TDialect, TDeclaration>
/** Alias for the dialect-owned descriptor terminology. */
export type NativeStorageDescriptor<
  TDialect extends string = string,
  TDeclaration extends string = string,
> = NativeColumnStorage<TDialect, TDeclaration>
/** Alias for the portable branch of {@link ColumnStorage}. */
export type PortableStorage<TType extends PortableStorageType = PortableStorageType> =
  PortableColumnStorage<TType>
/** Alias for the portable descriptor terminology. */
export type PortableStorageDescriptor<TType extends PortableStorageType = PortableStorageType> =
  PortableColumnStorage<TType>
/** Alias for the native branch of {@link ColumnStorage}. */
export type NativeStorage<
  TDialect extends string = string,
  TDeclaration extends string = string,
> = NativeColumnStorage<TDialect, TDeclaration>

/** Create an immutable portable physical storage descriptor. */
export function portableStorage<const TType extends PortableStorageType>(
  type: TType,
): PortableColumnStorage<TType> {
  return Object.freeze({
    kind: "portable" as const,
    type,
  })
}

/** Create an immutable dialect-native physical storage descriptor. */
export function nativeStorage<const TDialect extends string, const TDeclaration extends string>(
  dialect: TDialect,
  type: TDeclaration,
): NativeColumnStorage<TDialect, TDeclaration>
/** Create a native descriptor from a named object for adapter integrations. */
export function nativeStorage<
  const TDialect extends string,
  const TDeclaration extends string,
>(options: {
  readonly dialect: TDialect
  readonly type: TDeclaration
}): NativeColumnStorage<TDialect, TDeclaration>
/** Accept `declaration` when adapting an external type registry. */
export function nativeStorage<
  const TDialect extends string,
  const TDeclaration extends string,
>(options: {
  readonly dialect: TDialect
  readonly declaration: TDeclaration
}): NativeColumnStorage<TDialect, TDeclaration>
export function nativeStorage(
  dialectOrOptions:
    | string
    | {
        readonly dialect: string
        readonly type: string
      }
    | {
        readonly dialect: string
        readonly declaration: string
      },
  type?: string,
): NativeColumnStorage {
  const dialect = typeof dialectOrOptions === "string" ? dialectOrOptions : dialectOrOptions.dialect
  const declaration = (
    typeof dialectOrOptions === "string"
      ? type
      : "type" in dialectOrOptions
        ? dialectOrOptions.type
        : dialectOrOptions.declaration
  ) as string

  return Object.freeze({
    kind: "native" as const,
    dialect,
    type: declaration,
  })
}

/** Describes the storage branch carried by a column definition. */
export type ColumnStorageOf<T> = T extends {
  readonly storage?: infer TStorage
}
  ? TStorage
  : never

/** Extract the portable storage category from a column definition. */
export type ColumnStorageTypeOf<T> =
  Extract<ColumnStorageOf<T>, PortableColumnStorage> extends PortableColumnStorage<infer TType>
    ? TType
    : never

/** Extract the owning dialect from a native column definition. */
export type ColumnStorageDialectOf<T> =
  Extract<ColumnStorageOf<T>, NativeColumnStorage> extends NativeColumnStorage<infer TDialect, any>
    ? TDialect
    : never

/** Extract the exact native declaration from a column definition. */
export type ColumnStorageDeclarationOf<T> =
  Extract<ColumnStorageOf<T>, NativeColumnStorage> extends NativeColumnStorage<
    any,
    infer TDeclaration
  >
    ? TDeclaration
    : never

/** Extract the descriptor discriminant from a column definition. */
export type ColumnStorageKindOf<T> = Extract<ColumnStorageOf<T>, ColumnStorage>["kind"]

/** Short alias for {@link ColumnStorageOf}. */
export type StorageOf<T> = ColumnStorageOf<T>
/** Alias matching the existing `ColumnSqlType` extraction naming. */
export type ColumnStorageType<T> = ColumnStorageOf<T>
/** Alias for the portable category extraction. */
export type StorageTypeOf<T> = ColumnStorageTypeOf<T>
/** Alias for the dialect extraction. */
export type StorageDialectOf<T> = ColumnStorageDialectOf<T>
/** Alias for the native declaration extraction. */
export type StorageDeclarationOf<T> = ColumnStorageDeclarationOf<T>

/** Live conversion between one column's application and physical driver values. */
export interface ColumnCodec<TOutput = unknown, TInsert = TOutput, TDriver = unknown> {
  readonly toDriver: (value: TInsert) => TDriver
  readonly fromDriver: (value: TDriver) => TOutput
}

export interface ColumnOptions<TOutput = unknown, TInsert = TOutput> {
  readonly nullable?: boolean
  readonly hasDefault?: boolean
  readonly generated?: boolean
  /** A literal, deterministic expression, or externally managed default. */
  readonly default?: ColumnDefaultInput
  /** Supply an application value when an insert omits this column. */
  readonly defaultFn?: () => TInsert
  /** Complete generated-column metadata, independent of identity behavior. */
  readonly generatedColumn?: GeneratedColumnDescriptor
  /** Database identity metadata; identity is not an ordinary expression. */
  readonly identity?: IdentityDescriptor
  /** MySQL's optional parameter-free `ON UPDATE` expression. */
  readonly onUpdate?: AnySchemaExpression
  /** Override the snake_case SQL identifier derived from the field name. */
  readonly sqlName?: string
  /** Runtime SQL semantic domain name for adapter binding and result metadata. */
  readonly sqlType?: SqlTypeName
  /** Physical storage metadata for a custom column definition. */
  readonly storage?: ColumnStorage
  /** Dialect-owned column metadata retained by schema snapshots. */
  readonly dialect?: SchemaDialectExtension
  /** Override adapter decoding for values selected from this column. */
  readonly decode?: ResultDecoder
  /** Convert values at the live application-to-driver boundary without affecting schema metadata. */
  readonly codec?: ColumnCodec<TOutput, TInsert, unknown>
  /**
   * Raw SQL target that makes a custom definition reusable with cast(). The value is emitted
   * verbatim and must come from trusted source code.
   */
  readonly castType?: string
}

type BuiltInColumnOptions<TOutput> = Omit<
  ColumnOptions<TOutput, TOutput>,
  "castType" | "sqlType" | "storage"
> & {
  readonly castType?: never
  readonly sqlType?: never
  readonly storage?: never
}

/** Sparse type-level configuration carried by a column definition. */
export interface ColumnDefinitionConfig {
  /** Application value selected from the column. Defaults to `unknown`. */
  readonly output?: unknown
  /** Whether SQL `NULL` is permitted. Defaults to `false`. */
  readonly nullable?: boolean
  /** Accepted insert value. Defaults to `output`. */
  readonly insert?: unknown
  /** Accepted update value. Defaults to `insert`. */
  readonly update?: unknown
  /** Whether an insert may omit the column. Defaults to `false`. */
  readonly hasDefault?: boolean
  /** Whether an application runtime default can supply an omitted insert. */
  readonly hasRuntimeDefault?: boolean
  /** Whether the database generates the column. Defaults to `false`. */
  readonly generated?: boolean
  /** SQL semantic domain. Defaults to {@link SqlUnknown}. */
  readonly sqlType?: AnySqlType
  /** Physical storage metadata. Defaults to `undefined`. */
  readonly storage?: ColumnStorage
  /** Complete default metadata. Defaults to `undefined`. */
  readonly default?: ColumnDefault
  /** Complete generated-column metadata. Defaults to `undefined`. */
  readonly generatedColumn?: GeneratedColumnDescriptor
  /** Identity metadata. Defaults to `undefined`. */
  readonly identity?: IdentityDescriptor
  /** Deterministic `ON UPDATE` expression. Defaults to `undefined`. */
  readonly onUpdate?: AnySchemaExpression
}

type ConfigValue<TConfig, TKey extends PropertyKey, TFallback> = TKey extends keyof TConfig
  ? TConfig[TKey]
  : TFallback

type ColumnConfigOutput<TConfig> = ConfigValue<TConfig, "output", unknown>
type ConfigBoolean<TConfig, TKey extends PropertyKey> =
  Extract<ConfigValue<TConfig, TKey, false>, boolean> extends infer TValue
    ? [TValue] extends [never]
      ? false
      : TValue
    : false
type ColumnConfigNullable<TConfig> = ConfigBoolean<TConfig, "nullable">
type ColumnConfigInsert<TConfig> = ConfigValue<TConfig, "insert", ColumnConfigOutput<TConfig>>
type ColumnConfigUpdate<TConfig> = ConfigValue<TConfig, "update", ColumnConfigInsert<TConfig>>
type ColumnConfigHasDefault<TConfig> = ConfigBoolean<TConfig, "hasDefault">
type ColumnConfigHasRuntimeDefault<TConfig> = ConfigBoolean<TConfig, "hasRuntimeDefault">
type ColumnConfigGenerated<TConfig> = ConfigBoolean<TConfig, "generated">
type ColumnConfigSqlType<TConfig> =
  Extract<ConfigValue<TConfig, "sqlType", SqlUnknown>, AnySqlType> extends infer TValue
    ? [TValue] extends [never]
      ? SqlUnknown
      : TValue
    : SqlUnknown
type ColumnConfigStorage<TConfig> = ConfigValue<TConfig, "storage", undefined>
type ColumnConfigDefault<TConfig> = ConfigValue<TConfig, "default", undefined>
type ColumnConfigGeneratedColumn<TConfig> = ConfigValue<TConfig, "generatedColumn", undefined>
type ColumnConfigIdentity<TConfig> = ConfigValue<TConfig, "identity", undefined>
type ColumnConfigOnUpdate<TConfig> = ConfigValue<TConfig, "onUpdate", undefined>

type SetColumnOutput<TConfig, TOutput> = Omit<TConfig, "output" | "insert" | "update"> & {
  readonly output: TOutput
  readonly insert: SameType<ColumnConfigInsert<TConfig>, ColumnConfigOutput<TConfig>> extends true
    ? TOutput
    : ColumnConfigInsert<TConfig>
  readonly update: SameType<ColumnConfigUpdate<TConfig>, ColumnConfigOutput<TConfig>> extends true
    ? TOutput
    : ColumnConfigUpdate<TConfig>
}

export interface ColumnDefinition<TConfig extends ColumnDefinitionConfig = {}> {
  /** @internal Type-level configuration retained for inference. */
  readonly __config?: TConfig
  readonly definitionKind: "column"
  readonly nullable: ColumnConfigNullable<TConfig>
  readonly hasDefault: ColumnConfigHasDefault<TConfig>
  readonly hasRuntimeDefault: ColumnConfigHasRuntimeDefault<TConfig>
  readonly generated: ColumnConfigGenerated<TConfig>
  /** Complete database default metadata, when known. */
  readonly default?: ColumnConfigDefault<TConfig>
  /** Complete generated-column metadata, when known. */
  readonly generatedColumn?: ColumnConfigGeneratedColumn<TConfig>
  /** Identity behavior is modeled separately from generated expressions. */
  readonly identity?: ColumnConfigIdentity<TConfig>
  /** MySQL's optional parameter-free `ON UPDATE` expression. */
  readonly onUpdate?: ColumnConfigOnUpdate<TConfig>
  readonly sqlName?: string
  /** Runtime SQL semantic domain name for adapter binding and result metadata. */
  readonly sqlType?: SqlTypeName
  /** Physical storage metadata, separate from the application and SQL types. */
  readonly storage?: ColumnConfigStorage<TConfig>
  /** Dialect-owned metadata retained by schema snapshots. */
  readonly dialect?: SchemaDialectExtension
  /** Runtime decoder used when this definition is projected. */
  readonly resultDecoder?: ResultDecoder
  /** Runtime default used when an application insert omits this definition. */
  readonly defaultFn?: () => ColumnConfigInsert<TConfig>
  /** Runtime encoder applied to application values written through this definition. */
  readonly parameterEncoder?: (value: ColumnConfigInsert<TConfig>) => unknown
  /** Live application/driver codec available to integration adapters. */
  readonly columnCodec?: ColumnCodec<
    ColumnConfigOutput<TConfig>,
    ColumnConfigInsert<TConfig>,
    unknown
  >
  /** Runtime CAST target when this definition can describe a cast result. */
  readonly castTarget?: CastTarget
  readonly __output?: ColumnConfigOutput<TConfig>
  readonly __insert?: ColumnConfigInsert<TConfig>
  readonly __update?: ColumnConfigUpdate<TConfig>
  /**
   * Narrow the column's application type without changing its runtime definition.
   *
   * @remarks
   *   Distinct insert or update types are preserved. This method does not validate values or add a
   *   database constraint.
   */
  readonly $type: <const TType extends ColumnConfigOutput<TConfig>>() => ColumnDefinition<
    SetColumnOutput<TConfig, TType>
  > &
    (this extends { readonly castTarget: infer TCastTarget extends CastTarget }
      ? { readonly castTarget: TCastTarget }
      : unknown)
  readonly __sqlType?: ColumnConfigSqlType<TConfig>
}

type Flag<T extends boolean | undefined> = T extends true ? true : false

type HasExplicitOption<TOptions, TKey extends PropertyKey> = TKey extends keyof TOptions
  ? {} extends Pick<TOptions, TKey>
    ? false
    : true
  : false

type ColumnHasDefaultOption<TOptions extends ColumnOptions<any, any>> =
  HasExplicitOption<TOptions, "default"> extends true ? true : Flag<TOptions["hasDefault"]>

type ColumnHasRuntimeDefaultOption<TOptions extends ColumnOptions<any, any>> = TOptions extends {
  readonly defaultFn: () => unknown
}
  ? true
  : false

type ColumnIsGeneratedOption<TOptions extends ColumnOptions<any, any>> = TOptions extends {
  readonly generatedColumn: GeneratedColumnDescriptor
}
  ? true
  : TOptions extends { readonly identity: IdentityDescriptor }
    ? true
    : Flag<TOptions["generated"]>

type ColumnDefaultOption<TOptions extends ColumnOptions<any, any>> =
  HasExplicitOption<TOptions, "default"> extends true
    ? TOptions extends { readonly default: infer TDefault }
      ? TDefault extends AnySchemaExpression
        ? ExpressionDefaultDescriptor<TDefault>
        : TDefault extends ExternalDefaultDescriptor
          ? TDefault
          : TDefault extends SchemaLiteralValue
            ? LiteralDefaultDescriptor
            : never
      : never
    : TOptions["hasDefault"] extends true
      ? ExternalDefaultDescriptor
      : undefined

type ColumnGeneratedOption<TOptions extends ColumnOptions<any, any>> = TOptions extends {
  readonly generatedColumn: infer TGenerated extends GeneratedColumnDescriptor
}
  ? TGenerated
  : TOptions["generated"] extends true
    ? ExternalGeneratedColumnDescriptor
    : undefined

type ColumnIdentityOption<TOptions extends ColumnOptions<any, any>> = TOptions extends {
  readonly identity: infer TIdentity extends IdentityDescriptor
}
  ? TIdentity
  : undefined

type ColumnOnUpdateOption<TOptions extends ColumnOptions<any, any>> = TOptions extends {
  readonly onUpdate: infer TOnUpdate extends AnySchemaExpression
}
  ? TOnUpdate
  : undefined

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

type Simplify<T> = { readonly [TKey in keyof T]: T[TKey] }

type ColumnValueConfig<TOutput, TInsert, TUpdate> = {
  readonly output: TOutput
} & (SameType<TInsert, TOutput> extends true ? {} : { readonly insert: TInsert }) &
  (SameType<TUpdate, TInsert> extends true ? {} : { readonly update: TUpdate })

type TrueConfig<TKey extends PropertyKey, TValue> = TValue extends true
  ? { readonly [TField in TKey]: true }
  : {}

type DefinedConfig<TKey extends PropertyKey, TValue> = [TValue] extends [undefined]
  ? {}
  : { readonly [TField in TKey]: TValue }

type ColumnOptionConfig<TOptions extends ColumnOptions<any, any>> = Simplify<
  TrueConfig<"nullable", Flag<TOptions["nullable"]>> &
    TrueConfig<"hasDefault", ColumnHasDefaultOption<TOptions>> &
    TrueConfig<"hasRuntimeDefault", ColumnHasRuntimeDefaultOption<TOptions>> &
    TrueConfig<"generated", ColumnIsGeneratedOption<TOptions>> &
    DefinedConfig<"default", ColumnDefaultOption<TOptions>> &
    DefinedConfig<"generatedColumn", ColumnGeneratedOption<TOptions>> &
    DefinedConfig<"identity", ColumnIdentityOption<TOptions>> &
    DefinedConfig<"onUpdate", ColumnOnUpdateOption<TOptions>> &
    (TOptions extends { readonly storage: infer TStorage extends ColumnStorage }
      ? { readonly storage: TStorage }
      : {})
>

type BuiltInColumnDefinition<
  TOutput,
  TSqlType extends AnySqlType,
  TStorageType extends PortableStorageType,
  TCastType extends PortableCastType,
  TOptions extends BuiltInColumnOptions<TOutput>,
> = ColumnDefinition<
  Simplify<
    {
      readonly output: TOutput
      readonly sqlType: TSqlType
      readonly storage: PortableColumnStorage<TStorageType>
    } & ColumnOptionConfig<TOptions>
  >
> & {
  readonly castTarget: PortableCastTarget<TCastType>
}

export type ColumnFromOptions<
  TOutput,
  TInsert,
  TUpdate,
  TOptions extends ColumnOptions<TOutput, TInsert>,
  TSqlType extends AnySqlType = SqlUnknown,
> = ColumnDefinition<
  Simplify<
    ColumnValueConfig<TOutput, TInsert, TUpdate> & {
      readonly sqlType: TSqlType
    } & ColumnOptionConfig<TOptions>
  >
> &
  (TOptions extends { readonly castType: string }
    ? { readonly castTarget: NamedCastTarget }
    : unknown)

export type ColumnOutput<T> = T extends {
  readonly __output?: infer TOutput
  readonly nullable: infer TNullable
}
  ? TNullable extends true
    ? TOutput | null
    : TOutput
  : never

export type ColumnInsertInput<T> = T extends {
  readonly __insert?: infer TInsert
  readonly nullable: infer TNullable
}
  ? TNullable extends true
    ? TInsert | null
    : TInsert
  : never

export type ColumnUpdateInput<T> = T extends {
  readonly __update?: infer TUpdate
  readonly nullable: infer TNullable
}
  ? TNullable extends true
    ? TUpdate | null
    : TUpdate
  : never

export type ColumnHasDefault<T> = T extends {
  readonly hasDefault: infer THasDefault extends boolean
}
  ? THasDefault
  : false

/** Whether an omitted application insert can be supplied at runtime. */
export type ColumnHasRuntimeDefault<T> = T extends {
  readonly hasRuntimeDefault: infer THasRuntimeDefault extends boolean
}
  ? THasRuntimeDefault
  : false

export type ColumnIsGenerated<T> = T extends {
  readonly generated: infer TGenerated extends boolean
}
  ? TGenerated
  : false

/** Extract complete default metadata from a column definition. */
export type ColumnDefaultOf<T> = T extends { readonly default?: infer TDefault }
  ? TDefault
  : undefined

/** Extract complete generated-column metadata from a column definition. */
export type ColumnGeneratedOf<T> = T extends {
  readonly generatedColumn?: infer TGenerated
}
  ? TGenerated
  : undefined

/** Extract identity metadata from a column definition. */
export type ColumnIdentityOf<T> = T extends {
  readonly identity?: infer TIdentity
}
  ? TIdentity
  : undefined

/** Extract a column's optional deterministic `ON UPDATE` expression. */
export type ColumnOnUpdateOf<T> = T extends {
  readonly onUpdate?: infer TOnUpdate
}
  ? TOnUpdate
  : undefined

/** Extract the SQL semantic domain declared by a column definition. */
export type ColumnSqlType<T> = T extends {
  readonly __sqlType?: infer TSqlType extends AnySqlType
}
  ? TSqlType
  : SqlUnknown

/** Whether a column definition explicitly permits SQL NULL values. */
export type ColumnIsNullable<T> = T extends {
  readonly nullable: infer TNullable extends boolean
}
  ? TNullable
  : false

type FalseColumnOptions = {
  readonly nullable?: false
  readonly hasDefault?: false
  readonly generated?: false
  readonly sqlName?: string
  readonly decode?: ResultDecoder
}

type AnyColumnDefinition = ColumnDefinition<any>

type NamedCastColumn<TDefinition extends AnyColumnDefinition> = TDefinition & {
  readonly castTarget: NamedCastTarget
}

type PortableCastColumn<
  TDefinition extends AnyColumnDefinition,
  TType extends PortableCastType,
> = TDefinition & {
  readonly castTarget: PortableCastTarget<TType>
}

type StoredColumnDefinition<
  TDefinition extends AnyColumnDefinition,
  TStorage extends ColumnStorage,
> =
  TDefinition extends ColumnDefinition<infer TConfig>
    ? ColumnDefinition<Simplify<Omit<TConfig, "storage"> & { readonly storage: TStorage }>> &
        (TDefinition extends {
          readonly castTarget: infer TCastTarget extends CastTarget
        }
          ? { readonly castTarget: TCastTarget }
          : unknown)
    : never

function withPortableCast<
  TDefinition extends AnyColumnDefinition,
  const TType extends PortableCastType,
>(definition: TDefinition, type: TType): PortableCastColumn<TDefinition, TType> {
  return Object.freeze({
    ...definition,
    castTarget: Object.freeze({
      kind: "portable-cast" as const,
      type,
    }),
  })
}

function withPortableStorage<
  TDefinition extends AnyColumnDefinition,
  const TType extends PortableStorageType,
>(
  definition: TDefinition,
  type: TType,
): StoredColumnDefinition<TDefinition, PortableColumnStorage<TType>> {
  return Object.freeze({
    ...definition,
    storage: portableStorage(type),
    sqlType: type === "numeric" ? "decimal" : type,
  }) as StoredColumnDefinition<TDefinition, PortableColumnStorage<TType>>
}

export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
  const TStorage extends ColumnStorage = ColumnStorage,
  const TOptions extends Omit<ColumnOptions<TOutput, TInsert>, "storage"> = Omit<
    ColumnOptions<TOutput, TInsert>,
    "storage"
  >,
>(
  options: TOptions & { readonly storage: TStorage },
): ColumnFromOptions<TOutput, TInsert, TUpdate, TOptions & { readonly storage: TStorage }, TSqlType>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
>(
  options: FalseColumnOptions & { readonly castType: string },
): NamedCastColumn<
  ColumnDefinition<
    Simplify<
      ColumnValueConfig<TOutput, TInsert, TUpdate> & {
        readonly sqlType: TSqlType
      }
    >
  >
>

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
}): ColumnDefinition<
  Simplify<
    ColumnValueConfig<TOutput, TInsert, TUpdate> & {
      readonly nullable: true
      readonly hasDefault: true
      readonly generated: true
      readonly sqlType: TSqlType
      readonly default: ExternalDefaultDescriptor
      readonly generatedColumn: ExternalGeneratedColumnDescriptor
    }
  >
>
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
}): ColumnDefinition<
  Simplify<
    ColumnValueConfig<TOutput, TInsert, TUpdate> & {
      readonly nullable: true
      readonly hasDefault: true
      readonly sqlType: TSqlType
      readonly default: ExternalDefaultDescriptor
    }
  >
>
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
}): ColumnDefinition<
  Simplify<
    ColumnValueConfig<TOutput, TInsert, TUpdate> & {
      readonly nullable: true
      readonly generated: true
      readonly sqlType: TSqlType
      readonly generatedColumn: ExternalGeneratedColumnDescriptor
    }
  >
>
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
}): ColumnDefinition<
  Simplify<
    ColumnValueConfig<TOutput, TInsert, TUpdate> & {
      readonly nullable: true
      readonly sqlType: TSqlType
    }
  >
>
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
}): ColumnDefinition<
  Simplify<
    ColumnValueConfig<TOutput, TInsert, TUpdate> & {
      readonly hasDefault: true
      readonly generated: true
      readonly sqlType: TSqlType
      readonly default: ExternalDefaultDescriptor
      readonly generatedColumn: ExternalGeneratedColumnDescriptor
    }
  >
>
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
}): ColumnDefinition<
  Simplify<
    ColumnValueConfig<TOutput, TInsert, TUpdate> & {
      readonly hasDefault: true
      readonly sqlType: TSqlType
      readonly default: ExternalDefaultDescriptor
    }
  >
>
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
}): ColumnDefinition<
  Simplify<
    ColumnValueConfig<TOutput, TInsert, TUpdate> & {
      readonly generated: true
      readonly sqlType: TSqlType
      readonly generatedColumn: ExternalGeneratedColumnDescriptor
    }
  >
>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
>(
  options?: FalseColumnOptions,
): ColumnDefinition<
  Simplify<
    ColumnValueConfig<TOutput, TInsert, TUpdate> & {
      readonly sqlType: TSqlType
    }
  >
>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
  const TOptions extends ColumnOptions<TOutput, TInsert> = {},
>(options?: TOptions): ColumnFromOptions<TOutput, TInsert, TUpdate, TOptions, TSqlType>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  const TOptions extends ColumnOptions<TOutput, TInsert> = {},
  TSqlType extends AnySqlType = SqlUnknown,
>(options?: TOptions): ColumnFromOptions<TOutput, TInsert, TUpdate, TOptions, TSqlType>
export function column<const TOptions extends ColumnOptions<any, any> = {}>(
  options?: TOptions,
): any {
  return Object.freeze({
    definitionKind: "column" as const,
    nullable: options?.nullable === true,
    ...resolveColumnBehavior(options ?? {}),
    sqlName: options?.sqlName,
    ...(options?.sqlType === undefined ? {} : { sqlType: options.sqlType }),
    storage: options?.storage ? Object.freeze({ ...options.storage }) : undefined,
    dialect: options?.dialect,
    ...(options?.decode === undefined && options?.codec === undefined
      ? {}
      : { resultDecoder: options?.decode ?? options?.codec?.fromDriver }),
    ...(options?.codec === undefined
      ? {}
      : {
          parameterEncoder: options.codec.toDriver,
          columnCodec: Object.freeze({ ...options.codec }),
        }),
    $type: narrowColumnType,
    castTarget: options?.castType
      ? Object.freeze({
          kind: "named-cast" as const,
          typeName: options.castType,
        })
      : undefined,
  })
}

/** Resolve the runtime result metadata carried by a column definition. */
export function columnResultValue(definition: {
  readonly sqlType?: SqlTypeName
  readonly resultDecoder?: ResultDecoder
}): ResultValueMetadata | undefined {
  const sqlType = columnSqlType(definition)
  const type =
    sqlType === "boolean" ||
    sqlType === "date" ||
    sqlType === "timestamp" ||
    sqlType === "json" ||
    sqlType === "bigint"
      ? sqlType
      : undefined

  return resultValue(type, definition.resultDecoder, sqlType)
}

/** Resolve a column's explicit runtime semantic SQL domain for driver-facing metadata. */
export function columnSqlType(definition: {
  readonly sqlType?: SqlTypeName
}): SqlTypeName | undefined {
  return definition.sqlType
}

/** Apply a live column codec while preserving SQL NULL unchanged. */
export function encodeColumnParameter(
  definition: { readonly parameterEncoder?: (value: any) => unknown },
  value: unknown,
): unknown {
  return value === null || definition.parameterEncoder === undefined
    ? value
    : definition.parameterEncoder(value)
}

type NativeColumnOptions<TOutput, TInsert> = Omit<ColumnOptions<TOutput, TInsert>, "storage"> & {
  readonly storage?: never
}

type NativeColumnFromOptions<
  TOutput,
  TInsert,
  TUpdate,
  TOptions extends NativeColumnOptions<TOutput, TInsert>,
  TSqlType extends AnySqlType,
  TDialect extends string,
  TDeclaration extends string,
> = ColumnDefinition<
  Simplify<
    ColumnValueConfig<TOutput, TInsert, TUpdate> & {
      readonly sqlType: TSqlType
    } & ColumnOptionConfig<TOptions> & {
        readonly storage: NativeColumnStorage<TDialect, TDeclaration>
      }
  >
> &
  (TOptions extends { readonly castType: string }
    ? { readonly castTarget: NamedCastTarget }
    : unknown)

/** Create a column whose physical declaration belongs to one SQL dialect. */
export function nativeColumn<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  const TOptions extends NativeColumnOptions<TOutput, TInsert> = {},
  TSqlType extends AnySqlType = SqlUnknown,
  const TDialect extends string = string,
  const TDeclaration extends string = string,
>(
  storage: NativeColumnStorage<TDialect, TDeclaration>,
  options?: TOptions,
): NativeColumnFromOptions<TOutput, TInsert, TUpdate, TOptions, TSqlType, TDialect, TDeclaration>
/** Create a dialect-native column from an adapter name and exact declaration. */
export function nativeColumn<
  const TDialect extends string,
  const TDeclaration extends string,
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  const TOptions extends NativeColumnOptions<TOutput, TInsert> = {},
  TSqlType extends AnySqlType = SqlUnknown,
>(
  dialect: TDialect,
  type: TDeclaration,
  options?: TOptions,
): NativeColumnFromOptions<TOutput, TInsert, TUpdate, TOptions, TSqlType, TDialect, TDeclaration>
export function nativeColumn(
  storageOrDialect: NativeColumnStorage | string,
  typeOrOptions?: string | NativeColumnOptions<any, any>,
  maybeOptions?: NativeColumnOptions<any, any>,
): any {
  const storage =
    typeof storageOrDialect === "string"
      ? nativeStorage(storageOrDialect, typeOrOptions as string)
      : storageOrDialect
  const options = (typeof storageOrDialect === "string" ? maybeOptions : typeOrOptions) as
    | NativeColumnOptions<any, any>
    | undefined

  return column({
    ...options,
    storage,
  })
}

export function nullable<TConfig extends ColumnDefinitionConfig>(
  definition: ColumnDefinition<TConfig>,
) {
  return Object.freeze({
    ...definition,
    nullable: true as const,
  }) as unknown as ColumnDefinition<
    Simplify<Omit<TConfig, "nullable"> & { readonly nullable: true }>
  >
}

export function integer<const TOptions extends BuiltInColumnOptions<number> = {}>(
  options?: TOptions,
): BuiltInColumnDefinition<number, SqlInteger, "integer", "integer", TOptions> {
  return withPortableStorage(
    withPortableCast(column<number, number, number, TOptions, SqlInteger>(options), "integer"),
    "integer",
  ) as unknown as BuiltInColumnDefinition<number, SqlInteger, "integer", "integer", TOptions>
}

export function numeric<const TOptions extends BuiltInColumnOptions<number> = {}>(
  options?: TOptions,
): BuiltInColumnDefinition<number, SqlDecimal, "numeric", "decimal", TOptions> {
  return withPortableStorage(
    withPortableCast(column<number, number, number, TOptions, SqlDecimal>(options), "decimal"),
    "numeric",
  ) as unknown as BuiltInColumnDefinition<number, SqlDecimal, "numeric", "decimal", TOptions>
}

export function text<const TOptions extends BuiltInColumnOptions<string> = {}>(
  options?: TOptions,
): BuiltInColumnDefinition<string, SqlText, "text", "text", TOptions> {
  return withPortableStorage(
    withPortableCast(column<string, string, string, TOptions, SqlText>(options), "text"),
    "text",
  ) as unknown as BuiltInColumnDefinition<string, SqlText, "text", "text", TOptions>
}

export function boolean<const TOptions extends BuiltInColumnOptions<boolean> = {}>(
  options?: TOptions,
): BuiltInColumnDefinition<boolean, SqlBoolean, "boolean", "boolean", TOptions> {
  return withPortableStorage(
    withPortableCast(column<boolean, boolean, boolean, TOptions, SqlBoolean>(options), "boolean"),
    "boolean",
  ) as unknown as BuiltInColumnDefinition<boolean, SqlBoolean, "boolean", "boolean", TOptions>
}

export function date<const TOptions extends BuiltInColumnOptions<Date> = {}>(
  options?: TOptions,
): BuiltInColumnDefinition<Date, SqlDate, "date", "date", TOptions> {
  return withPortableStorage(
    withPortableCast(column<Date, Date, Date, TOptions, SqlDate>(options), "date"),
    "date",
  ) as unknown as BuiltInColumnDefinition<Date, SqlDate, "date", "date", TOptions>
}

export function timestamp<const TOptions extends BuiltInColumnOptions<Date> = {}>(
  options?: TOptions,
): BuiltInColumnDefinition<Date, SqlTimestamp, "timestamp", "timestamp", TOptions> {
  return withPortableStorage(
    withPortableCast(column<Date, Date, Date, TOptions, SqlTimestamp>(options), "timestamp"),
    "timestamp",
  ) as unknown as BuiltInColumnDefinition<Date, SqlTimestamp, "timestamp", "timestamp", TOptions>
}

export function uuid<const TOptions extends BuiltInColumnOptions<string> = {}>(
  options?: TOptions,
): BuiltInColumnDefinition<string, SqlUuid, "uuid", "uuid", TOptions> {
  return withPortableStorage(
    withPortableCast(column<string, string, string, TOptions, SqlUuid>(options), "uuid"),
    "uuid",
  ) as unknown as BuiltInColumnDefinition<string, SqlUuid, "uuid", "uuid", TOptions>
}

export function json<TOutput = unknown, const TOptions extends BuiltInColumnOptions<TOutput> = {}>(
  options?: TOptions,
): BuiltInColumnDefinition<TOutput, SqlJson<TOutput>, "json", "json", TOptions> {
  return withPortableStorage(
    withPortableCast(
      column<TOutput, TOutput, TOutput, TOptions, SqlJson<TOutput>>(options),
      "json",
    ),
    "json",
  ) as unknown as BuiltInColumnDefinition<TOutput, SqlJson<TOutput>, "json", "json", TOptions>
}

export function bigint<const TOptions extends BuiltInColumnOptions<bigint> = {}>(
  options?: TOptions,
): BuiltInColumnDefinition<bigint, SqlBigInt, "bigint", "bigint", TOptions> {
  return withPortableStorage(
    withPortableCast(column<bigint, bigint, bigint, TOptions, SqlBigInt>(options), "bigint"),
    "bigint",
  ) as unknown as BuiltInColumnDefinition<bigint, SqlBigInt, "bigint", "bigint", TOptions>
}

export function binary<const TOptions extends BuiltInColumnOptions<Uint8Array> = {}>(
  options?: TOptions,
): BuiltInColumnDefinition<Uint8Array, SqlBinary, "binary", "binary", TOptions> {
  return withPortableStorage(
    withPortableCast(
      column<Uint8Array, Uint8Array, Uint8Array, TOptions, SqlBinary>(options),
      "binary",
    ),
    "binary",
  ) as unknown as BuiltInColumnDefinition<Uint8Array, SqlBinary, "binary", "binary", TOptions>
}
