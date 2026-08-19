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
  readonly capabilities?: readonly TCapabilities[]
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
