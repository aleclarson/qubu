import type { AnyFragment, RenderContext } from './fragment.ts'

/** Capabilities whose syntax must be explicitly supported by a dialect. */
export type DialectCapability = 'ilike' | 'json'

/** Scalar application types supported by the portable JSON renderer. */
export type JsonScalarKind = 'text' | 'number' | 'boolean'

/** Dialect policy for portable scalar JSON reads and path existence checks. */
export interface DialectJson {
  renderScalar(
    context: RenderContext,
    document: AnyFragment,
    path: readonly (string | number)[],
    kind: JsonScalarKind
  ): void
  renderExists(
    context: RenderContext,
    document: AnyFragment,
    path: readonly (string | number)[]
  ): void
}

export type PaginationKind = 'offset' | 'fetch'

/** Logical built-in targets that a dialect can spell in CAST expressions. */
export type PortableCastType =
  | 'integer'
  | 'decimal'
  | 'text'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'uuid'
  | 'json'
  | 'bigint'
  | 'binary'

/** A logical cast target whose concrete spelling is selected by a dialect. */
export interface PortableCastTarget<
  TType extends PortableCastType = PortableCastType,
> {
  readonly kind: 'portable-cast'
  readonly type: TType
}

/** A trusted raw cast target supplied by a custom definition. */
export interface NamedCastTarget<TTypeName extends string = string> {
  readonly kind: 'named-cast'
  readonly typeName: TTypeName
}

/** Runtime target carried by a definition that can be used with cast(). */
export type CastTarget = PortableCastTarget | NamedCastTarget

/** Dialect-specific spellings for built-in logical CAST targets. */
export type DialectCastTypes = Readonly<
  Partial<Record<PortableCastType, string>>
>

export interface PaginationPart {
  readonly kind: PaginationKind
  readonly rows: number
  readonly direction?: 'FIRST' | 'NEXT'
}

export interface DialectPagination {
  /** Render a complete pagination group in dialect-specific syntax. */
  readonly render: (
    context: RenderContext,
    parts: readonly PaginationPart[]
  ) => void
}

export interface Dialect<
  TCapabilities extends DialectCapability = DialectCapability,
> {
  readonly name: string
  quoteIdentifier(identifier: string): string
  placeholder(position: number): string
  readonly pagination?: DialectPagination
  /** Rendering policy for Qubu's portable JSON operations. */
  readonly json?: DialectJson
  /** Overrides for the standard spelling of logical CAST targets. */
  readonly castTypes?: DialectCastTypes
  /** Capabilities advertised by this dialect at the rendering boundary. */
  readonly capabilities?: readonly TCapabilities[]
}

export interface DialectOptions<
  TCapabilities extends Exclude<DialectCapability, 'json'> = never,
  TJson extends DialectJson | undefined = DialectJson | undefined,
> {
  readonly name: string
  readonly quoteIdentifier?: (identifier: string) => string
  readonly placeholder: (position: number) => string
  readonly pagination?: DialectPagination
  readonly json?: TJson
  /** Overrides for the standard spelling of logical CAST targets. */
  readonly castTypes?: DialectCastTypes
  readonly capabilities?: readonly TCapabilities[]
}

const standardCastTypes: Readonly<Record<PortableCastType, string>> = {
  integer: 'INTEGER',
  decimal: 'DECIMAL',
  text: 'TEXT',
  boolean: 'BOOLEAN',
  date: 'DATE',
  timestamp: 'TIMESTAMP',
  uuid: 'UUID',
  json: 'JSON',
  bigint: 'BIGINT',
  binary: 'VARBINARY',
}

/** Resolve a logical or explicitly named CAST target for a dialect. */
export function resolveCastTarget(
  dialect: Dialect,
  target: CastTarget
): string {
  if (target.kind === 'named-cast') return target.typeName
  return dialect.castTypes?.[target.type] ?? standardCastTypes[target.type]
}

const quoteIdentifier = (identifier: string) =>
  `"${identifier.replaceAll('"', '""')}` + '"'

/**
 * Create a dialect from the few rendering decisions that SQL builders need
 * to leave open. More involved syntax can be supplied as a custom fragment.
 */
export function createDialect<
  const TCapabilities extends Exclude<DialectCapability, 'json'> = never,
>(
  options: DialectOptions<TCapabilities, DialectJson> & {
    readonly json: DialectJson
  }
): Dialect<TCapabilities | 'json'>
export function createDialect<
  const TCapabilities extends Exclude<DialectCapability, 'json'> = never,
>(options: DialectOptions<TCapabilities, undefined>): Dialect<TCapabilities>
export function createDialect(
  options: DialectOptions<Exclude<DialectCapability, 'json'>>
): Dialect {
  return Object.freeze({
    name: options.name,
    quoteIdentifier: options.quoteIdentifier ?? quoteIdentifier,
    placeholder: options.placeholder,
    pagination: options.pagination,
    json: options.json,
    castTypes: options.castTypes
      ? Object.freeze({ ...options.castTypes })
      : undefined,
    capabilities: Object.freeze([
      ...(options.capabilities ?? []),
      ...(options.json ? (['json'] as const) : []),
    ]),
  }) as Dialect
}

/**
 * Check a capability at runtime for callers that intentionally bypass the
 * typed render boundary or use a dialect supplied by an older integration.
 */
export function assertDialectCapability(
  dialect: Dialect,
  capability: DialectCapability
): void {
  if (dialect.capabilities?.includes(capability)) return

  throw new Error(
    `Dialect "${dialect.name}" does not support the "${capability}" capability`
  )
}
