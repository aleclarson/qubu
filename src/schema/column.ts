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
import type {
  CastTarget,
  NamedCastTarget,
  PortableCastTarget,
  PortableCastType,
} from '../core/dialect.ts'
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
} from './column-behavior.ts'
import type { AnySchemaExpression } from '../expressions/types.ts'

/** Portable physical storage spellings understood by every schema dialect. */
export type PortableStorageType =
  | 'integer'
  | 'numeric'
  | 'text'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'uuid'
  | 'json'
  | 'bigint'
  | 'binary'

/** A dialect-neutral physical storage descriptor. */
export interface PortableColumnStorage<
  TType extends PortableStorageType = PortableStorageType,
> {
  readonly kind: 'portable'
  /** Stable physical storage category, independent of the SQL domain. */
  readonly type: TType
}

/** A physical storage declaration owned by one SQL dialect. */
export interface NativeColumnStorage<
  TDialect extends string = string,
  TDeclaration extends string = string,
> {
  readonly kind: 'native'
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
export type PortableStorage<
  TType extends PortableStorageType = PortableStorageType,
> = PortableColumnStorage<TType>
/** Alias for the portable descriptor terminology. */
export type PortableStorageDescriptor<
  TType extends PortableStorageType = PortableStorageType,
> = PortableColumnStorage<TType>
/** Alias for the native branch of {@link ColumnStorage}. */
export type NativeStorage<
  TDialect extends string = string,
  TDeclaration extends string = string,
> = NativeColumnStorage<TDialect, TDeclaration>

/** Create an immutable portable physical storage descriptor. */
export function portableStorage<const TType extends PortableStorageType>(
  type: TType
): PortableColumnStorage<TType> {
  return Object.freeze({ kind: 'portable' as const, type })
}

/** Create an immutable dialect-native physical storage descriptor. */
export function nativeStorage<
  const TDialect extends string,
  const TDeclaration extends string,
>(
  dialect: TDialect,
  type: TDeclaration
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
    | { readonly dialect: string; readonly type: string }
    | { readonly dialect: string; readonly declaration: string },
  type?: string
): NativeColumnStorage {
  const dialect =
    typeof dialectOrOptions === 'string'
      ? dialectOrOptions
      : dialectOrOptions.dialect
  const declaration = (
    typeof dialectOrOptions === 'string'
      ? type
      : 'type' in dialectOrOptions
        ? dialectOrOptions.type
        : dialectOrOptions.declaration
  ) as string
  return Object.freeze({
    kind: 'native' as const,
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
  Extract<
    ColumnStorageOf<T>,
    PortableColumnStorage
  > extends PortableColumnStorage<infer TType>
    ? TType
    : never

/** Extract the owning dialect from a native column definition. */
export type ColumnStorageDialectOf<T> =
  Extract<ColumnStorageOf<T>, NativeColumnStorage> extends NativeColumnStorage<
    infer TDialect,
    any
  >
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
export type ColumnStorageKindOf<T> = Extract<
  ColumnStorageOf<T>,
  ColumnStorage
>['kind']

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

export interface ColumnOptions {
  readonly nullable?: boolean
  readonly hasDefault?: boolean
  readonly generated?: boolean
  /** A literal, deterministic expression, or externally managed default. */
  readonly default?: ColumnDefaultInput
  /** Complete generated-column metadata, independent of identity behavior. */
  readonly generatedColumn?: GeneratedColumnDescriptor
  /** Database identity metadata; identity is not an ordinary expression. */
  readonly identity?: IdentityDescriptor
  /** MySQL's optional parameter-free `ON UPDATE` expression. */
  readonly onUpdate?: AnySchemaExpression
  /** Override the snake_case SQL identifier derived from the field name. */
  readonly sqlName?: string
  /** Physical storage metadata for a custom column definition. */
  readonly storage?: ColumnStorage
  /**
   * Raw SQL target that makes a custom definition reusable with cast().
   * The value is emitted verbatim and must come from trusted source code.
   */
  readonly castType?: string
}

type BuiltInColumnOptions = Omit<ColumnOptions, 'castType' | 'storage'> & {
  readonly castType?: never
  readonly storage?: never
}

export interface ColumnDefinition<
  TOutput = unknown,
  TNullable extends boolean = false,
  TInsert = TOutput,
  TUpdate = TInsert,
  THasDefault extends boolean = false,
  TGenerated extends boolean = false,
  TSqlType extends AnySqlType = SqlUnknown,
  TStorage extends ColumnStorage | undefined = undefined,
  TDefault extends ColumnDefault | undefined = ColumnDefault | undefined,
  TGeneratedColumn extends GeneratedColumnDescriptor | undefined =
    | GeneratedColumnDescriptor
    | undefined,
  TIdentity extends IdentityDescriptor | undefined =
    | IdentityDescriptor
    | undefined,
  TOnUpdate extends AnySchemaExpression | undefined =
    | AnySchemaExpression
    | undefined,
> {
  readonly definitionKind: 'column'
  readonly nullable: TNullable
  readonly hasDefault: THasDefault
  readonly generated: TGenerated
  /** Complete database default metadata, when known. */
  readonly default?: TDefault
  /** Complete generated-column metadata, when known. */
  readonly generatedColumn?: TGeneratedColumn
  /** Identity behavior is modeled separately from generated expressions. */
  readonly identity?: TIdentity
  /** MySQL's optional parameter-free `ON UPDATE` expression. */
  readonly onUpdate?: TOnUpdate
  readonly sqlName?: string
  /** Physical storage metadata, separate from the application and SQL types. */
  readonly storage?: TStorage
  /** Runtime CAST target when this definition can describe a cast result. */
  readonly castTarget?: CastTarget
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
    TSqlType,
    TStorage,
    TDefault,
    TGeneratedColumn,
    TIdentity,
    TOnUpdate
  > &
    (this extends { readonly castTarget: infer TCastTarget extends CastTarget }
      ? { readonly castTarget: TCastTarget }
      : unknown)
  readonly __sqlType?: TSqlType
}

type Flag<T extends boolean | undefined> = T extends true ? true : false

type HasExplicitOption<
  TOptions,
  TKey extends PropertyKey,
> = TKey extends keyof TOptions
  ? {} extends Pick<TOptions, TKey>
    ? false
    : true
  : false

type ColumnHasDefaultOption<TOptions extends ColumnOptions> =
  HasExplicitOption<TOptions, 'default'> extends true
    ? true
    : Flag<TOptions['hasDefault']>

type ColumnIsGeneratedOption<TOptions extends ColumnOptions> =
  TOptions extends {
    readonly generatedColumn: GeneratedColumnDescriptor
  }
    ? true
    : TOptions extends { readonly identity: IdentityDescriptor }
      ? true
      : Flag<TOptions['generated']>

type ColumnDefaultOption<TOptions extends ColumnOptions> =
  HasExplicitOption<TOptions, 'default'> extends true
    ? TOptions extends { readonly default: infer TDefault }
      ? TDefault extends AnySchemaExpression
        ? ExpressionDefaultDescriptor<TDefault>
        : TDefault extends ExternalDefaultDescriptor
          ? TDefault
          : TDefault extends SchemaLiteralValue
            ? LiteralDefaultDescriptor
            : never
      : never
    : TOptions['hasDefault'] extends true
      ? ExternalDefaultDescriptor
      : undefined

type ColumnGeneratedOption<TOptions extends ColumnOptions> = TOptions extends {
  readonly generatedColumn: infer TGenerated extends GeneratedColumnDescriptor
}
  ? TGenerated
  : TOptions['generated'] extends true
    ? ExternalGeneratedColumnDescriptor
    : undefined

type ColumnIdentityOption<TOptions extends ColumnOptions> = TOptions extends {
  readonly identity: infer TIdentity extends IdentityDescriptor
}
  ? TIdentity
  : undefined

type ColumnOnUpdateOption<TOptions extends ColumnOptions> = TOptions extends {
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
  ColumnHasDefaultOption<TOptions>,
  ColumnIsGeneratedOption<TOptions>,
  TSqlType,
  TOptions extends { readonly storage: infer TStorage }
    ? TStorage extends ColumnStorage
      ? TStorage
      : undefined
    : undefined,
  ColumnDefaultOption<TOptions>,
  ColumnGeneratedOption<TOptions>,
  ColumnIdentityOption<TOptions>,
  ColumnOnUpdateOption<TOptions>
> &
  (TOptions extends { readonly castType: string }
    ? { readonly castTarget: NamedCastTarget }
    : unknown)

export type ColumnOutput<T> =
  T extends ColumnDefinition<
    infer TOutput,
    infer TNullable,
    any,
    any,
    any,
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
    any,
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
    any,
    any,
    any,
    any,
    any
  >
    ? TNullable extends true
      ? TUpdate | null
      : TUpdate
    : never

export type ColumnHasDefault<T> =
  T extends ColumnDefinition<
    any,
    any,
    any,
    any,
    infer THasDefault,
    any,
    any,
    any,
    any,
    any,
    any
  >
    ? THasDefault
    : false

export type ColumnIsGenerated<T> =
  T extends ColumnDefinition<
    any,
    any,
    any,
    any,
    any,
    infer TGenerated,
    any,
    any,
    any,
    any,
    any
  >
    ? TGenerated
    : false

/** Extract complete default metadata from a column definition. */
export type ColumnDefaultOf<T> =
  T extends ColumnDefinition<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    infer TDefault,
    any,
    any
  >
    ? TDefault
    : undefined

/** Extract complete generated-column metadata from a column definition. */
export type ColumnGeneratedOf<T> =
  T extends ColumnDefinition<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    infer TGenerated,
    any
  >
    ? TGenerated
    : undefined

/** Extract identity metadata from a column definition. */
export type ColumnIdentityOf<T> =
  T extends ColumnDefinition<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    infer TIdentity
  >
    ? TIdentity
    : undefined

/** Extract a column's optional deterministic `ON UPDATE` expression. */
export type ColumnOnUpdateOf<T> =
  T extends ColumnDefinition<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    infer TOnUpdate
  >
    ? TOnUpdate
    : undefined

/** Extract the SQL semantic domain declared by a column definition. */
export type ColumnSqlType<T> =
  T extends ColumnDefinition<
    any,
    any,
    any,
    any,
    any,
    any,
    infer TSqlType,
    any,
    any,
    any,
    any
  >
    ? TSqlType
    : SqlUnknown

/** Whether a column definition explicitly permits SQL NULL values. */
export type ColumnIsNullable<T> =
  T extends ColumnDefinition<
    any,
    infer TNullable,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >
    ? TNullable
    : false

type FalseColumnOptions = {
  readonly nullable?: false
  readonly hasDefault?: false
  readonly generated?: false
  readonly sqlName?: string
}

type AnyColumnDefinition = ColumnDefinition<
  any,
  any,
  any,
  any,
  any,
  any,
  AnySqlType,
  any,
  any,
  any,
  any
>

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
  TDefinition extends ColumnDefinition<
    infer TOutput,
    infer TNullable,
    infer TInsert,
    infer TUpdate,
    infer THasDefault,
    infer TGenerated,
    infer TSqlType,
    any,
    infer TDefault,
    infer TGeneratedColumn,
    infer TIdentity,
    infer TOnUpdate
  >
    ? ColumnDefinition<
        TOutput,
        TNullable,
        TInsert,
        TUpdate,
        THasDefault,
        TGenerated,
        TSqlType,
        TStorage,
        TDefault,
        TGeneratedColumn,
        TIdentity,
        Extract<TOnUpdate, AnySchemaExpression> | undefined
      > &
        (TDefinition extends {
          readonly castTarget: infer TCastTarget extends CastTarget
        }
          ? { readonly castTarget: TCastTarget }
          : unknown)
    : never

function withPortableCast<
  TDefinition extends AnyColumnDefinition,
  const TType extends PortableCastType,
>(
  definition: TDefinition,
  type: TType
): PortableCastColumn<TDefinition, TType> {
  return Object.freeze({
    ...definition,
    castTarget: Object.freeze({ kind: 'portable-cast' as const, type }),
  })
}

function withPortableStorage<
  TDefinition extends AnyColumnDefinition,
  const TType extends PortableStorageType,
>(
  definition: TDefinition,
  type: TType
): StoredColumnDefinition<TDefinition, PortableColumnStorage<TType>> {
  return Object.freeze({
    ...definition,
    storage: portableStorage(type),
  }) as StoredColumnDefinition<TDefinition, PortableColumnStorage<TType>>
}

export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
  const TStorage extends ColumnStorage = ColumnStorage,
  const TOptions extends Omit<ColumnOptions, 'storage'> = Omit<
    ColumnOptions,
    'storage'
  >,
>(
  options: TOptions & { readonly storage: TStorage }
): ColumnFromOptions<
  TOutput,
  TInsert,
  TUpdate,
  TOptions & { readonly storage: TStorage },
  TSqlType
>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  TSqlType extends AnySqlType = SqlUnknown,
>(
  options: FalseColumnOptions & { readonly castType: string }
): NamedCastColumn<
  ColumnDefinition<TOutput, false, TInsert, TUpdate, false, false, TSqlType>
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
  TOutput,
  true,
  TInsert,
  TUpdate,
  true,
  true,
  TSqlType,
  undefined,
  ExternalDefaultDescriptor,
  ExternalGeneratedColumnDescriptor
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
  TOutput,
  true,
  TInsert,
  TUpdate,
  true,
  false,
  TSqlType,
  undefined,
  ExternalDefaultDescriptor
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
  TOutput,
  true,
  TInsert,
  TUpdate,
  false,
  true,
  TSqlType,
  undefined,
  undefined,
  ExternalGeneratedColumnDescriptor
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
}): ColumnDefinition<
  TOutput,
  false,
  TInsert,
  TUpdate,
  true,
  true,
  TSqlType,
  undefined,
  ExternalDefaultDescriptor,
  ExternalGeneratedColumnDescriptor
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
  TOutput,
  false,
  TInsert,
  TUpdate,
  true,
  false,
  TSqlType,
  undefined,
  ExternalDefaultDescriptor
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
  TOutput,
  false,
  TInsert,
  TUpdate,
  false,
  true,
  TSqlType,
  undefined,
  undefined,
  ExternalGeneratedColumnDescriptor
>
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
  TSqlType extends AnySqlType = SqlUnknown,
  const TOptions extends ColumnOptions = {},
>(
  options?: TOptions
): ColumnFromOptions<TOutput, TInsert, TUpdate, TOptions, TSqlType>
export function column<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  const TOptions extends ColumnOptions = {},
  TSqlType extends AnySqlType = SqlUnknown,
>(
  options?: TOptions
): ColumnFromOptions<TOutput, TInsert, TUpdate, TOptions, TSqlType>
export function column<const TOptions extends ColumnOptions = {}>(
  options?: TOptions
): any {
  return Object.freeze({
    definitionKind: 'column' as const,
    nullable: options?.nullable === true,
    ...resolveColumnBehavior(options ?? {}),
    sqlName: options?.sqlName,
    storage: options?.storage
      ? Object.freeze({ ...options.storage })
      : undefined,
    $type: narrowColumnType,
    castTarget: options?.castType
      ? Object.freeze({
          kind: 'named-cast' as const,
          typeName: options.castType,
        })
      : undefined,
  })
}

type NativeColumnOptions = Omit<ColumnOptions, 'storage'> & {
  readonly storage?: never
}

type NativeColumnFromOptions<
  TOutput,
  TInsert,
  TUpdate,
  TOptions extends NativeColumnOptions,
  TSqlType extends AnySqlType,
  TDialect extends string,
  TDeclaration extends string,
> = ColumnDefinition<
  TOutput,
  Flag<TOptions['nullable']>,
  TInsert,
  TUpdate,
  ColumnHasDefaultOption<TOptions>,
  ColumnIsGeneratedOption<TOptions>,
  TSqlType,
  NativeColumnStorage<TDialect, TDeclaration>,
  ColumnDefaultOption<TOptions>,
  ColumnGeneratedOption<TOptions>,
  ColumnIdentityOption<TOptions>,
  ColumnOnUpdateOption<TOptions>
> &
  (TOptions extends { readonly castType: string }
    ? { readonly castTarget: NamedCastTarget }
    : unknown)

/** Create a column whose physical declaration belongs to one SQL dialect. */
export function nativeColumn<
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  const TOptions extends NativeColumnOptions = {},
  TSqlType extends AnySqlType = SqlUnknown,
  const TDialect extends string = string,
  const TDeclaration extends string = string,
>(
  storage: NativeColumnStorage<TDialect, TDeclaration>,
  options?: TOptions
): NativeColumnFromOptions<
  TOutput,
  TInsert,
  TUpdate,
  TOptions,
  TSqlType,
  TDialect,
  TDeclaration
>
/** Create a dialect-native column from an adapter name and exact declaration. */
export function nativeColumn<
  const TDialect extends string,
  const TDeclaration extends string,
  TOutput = unknown,
  TInsert = TOutput,
  TUpdate = TInsert,
  const TOptions extends NativeColumnOptions = {},
  TSqlType extends AnySqlType = SqlUnknown,
>(
  dialect: TDialect,
  type: TDeclaration,
  options?: TOptions
): NativeColumnFromOptions<
  TOutput,
  TInsert,
  TUpdate,
  TOptions,
  TSqlType,
  TDialect,
  TDeclaration
>
export function nativeColumn(
  storageOrDialect: NativeColumnStorage | string,
  typeOrOptions?: string | NativeColumnOptions,
  maybeOptions?: NativeColumnOptions
): any {
  const storage =
    typeof storageOrDialect === 'string'
      ? nativeStorage(storageOrDialect, typeOrOptions as string)
      : storageOrDialect
  const options = (
    typeof storageOrDialect === 'string' ? maybeOptions : typeOrOptions
  ) as NativeColumnOptions | undefined
  return column({
    ...(options ?? {}),
    storage,
  })
}

/** Alias for integrations that call dialect-owned columns "dialect columns". */
export const dialectColumn = nativeColumn

export function nullable<
  TOutput,
  TNullable extends boolean,
  TInsert,
  TUpdate,
  THasDefault extends boolean,
  TGenerated extends boolean,
  TSqlType extends AnySqlType,
  TStorage extends ColumnStorage | undefined,
  TDefault extends ColumnDefault | undefined,
  TGeneratedColumn extends GeneratedColumnDescriptor | undefined,
  TIdentity extends IdentityDescriptor | undefined,
  TOnUpdate extends AnySchemaExpression | undefined,
>(
  definition: ColumnDefinition<
    TOutput,
    TNullable,
    TInsert,
    TUpdate,
    THasDefault,
    TGenerated,
    TSqlType,
    TStorage,
    TDefault,
    TGeneratedColumn,
    TIdentity,
    TOnUpdate
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
    TSqlType,
    TStorage,
    TDefault,
    TGeneratedColumn,
    TIdentity,
    TOnUpdate
  >
}

export function integer<const TOptions extends BuiltInColumnOptions = {}>(
  options?: TOptions
) {
  return withPortableStorage(
    withPortableCast(
      column<number, number, number, TOptions, SqlInteger>(options),
      'integer'
    ),
    'integer'
  )
}

export function numeric<const TOptions extends BuiltInColumnOptions = {}>(
  options?: TOptions
) {
  return withPortableStorage(
    withPortableCast(
      column<number, number, number, TOptions, SqlDecimal>(options),
      'decimal'
    ),
    'numeric'
  )
}

export function text<const TOptions extends BuiltInColumnOptions = {}>(
  options?: TOptions
) {
  return withPortableStorage(
    withPortableCast(
      column<string, string, string, TOptions, SqlText>(options),
      'text'
    ),
    'text'
  )
}

export function boolean<const TOptions extends BuiltInColumnOptions = {}>(
  options?: TOptions
) {
  return withPortableStorage(
    withPortableCast(
      column<boolean, boolean, boolean, TOptions, SqlBoolean>(options),
      'boolean'
    ),
    'boolean'
  )
}

export function date<const TOptions extends BuiltInColumnOptions = {}>(
  options?: TOptions
) {
  return withPortableStorage(
    withPortableCast(
      column<Date, Date, Date, TOptions, SqlDate>(options),
      'date'
    ),
    'date'
  )
}

export function timestamp<const TOptions extends BuiltInColumnOptions = {}>(
  options?: TOptions
) {
  return withPortableStorage(
    withPortableCast(
      column<Date, Date, Date, TOptions, SqlTimestamp>(options),
      'timestamp'
    ),
    'timestamp'
  )
}

/** Alias for timestamp columns whose application name emphasizes date-time. */
export const dateTime = timestamp

export function uuid<const TOptions extends BuiltInColumnOptions = {}>(
  options?: TOptions
) {
  return withPortableStorage(
    withPortableCast(
      column<string, string, string, TOptions, SqlUuid>(options),
      'uuid'
    ),
    'uuid'
  )
}

export function json<
  TOutput = unknown,
  const TOptions extends BuiltInColumnOptions = {},
>(options?: TOptions) {
  return withPortableStorage(
    withPortableCast(
      column<TOutput, TOutput, TOutput, TOptions, SqlJson<TOutput>>(options),
      'json'
    ),
    'json'
  )
}

export function bigint<const TOptions extends BuiltInColumnOptions = {}>(
  options?: TOptions
) {
  return withPortableStorage(
    withPortableCast(
      column<bigint, bigint, bigint, TOptions, SqlBigInt>(options),
      'bigint'
    ),
    'bigint'
  )
}

export function binary<const TOptions extends BuiltInColumnOptions = {}>(
  options?: TOptions
) {
  return withPortableStorage(
    withPortableCast(
      column<Uint8Array, Uint8Array, Uint8Array, TOptions, SqlBinary>(options),
      'binary'
    ),
    'binary'
  )
}

/** Common driver-neutral name for a binary/blob column. */
export const blob = binary
