import type { RenderContext } from './fragment.ts'

/** Capabilities whose syntax must be explicitly supported by a dialect. */
export type DialectCapability = 'ilike'

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
  /** Capabilities advertised by this dialect at the rendering boundary. */
  readonly capabilities?: readonly TCapabilities[]
}

export interface DialectOptions<
  TCapabilities extends DialectCapability = never,
> {
  readonly name: string
  readonly quoteIdentifier?: (identifier: string) => string
  readonly placeholder: (position: number) => string
  readonly pagination?: DialectPagination
  readonly capabilities?: readonly TCapabilities[]
}

const quoteIdentifier = (identifier: string) =>
  `"${identifier.replaceAll('"', '""')}` + '"'

/**
 * Create a dialect from the few rendering decisions that SQL builders need
 * to leave open. More involved syntax can be supplied as a custom fragment.
 */
export function createDialect<
  const TCapabilities extends DialectCapability = never,
>(options: DialectOptions<TCapabilities>): Dialect<TCapabilities> {
  return Object.freeze({
    name: options.name,
    quoteIdentifier: options.quoteIdentifier ?? quoteIdentifier,
    placeholder: options.placeholder,
    pagination: options.pagination,
    capabilities: Object.freeze([...(options.capabilities ?? [])]),
  }) as Dialect<TCapabilities>
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
