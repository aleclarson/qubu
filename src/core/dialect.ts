import type { RenderContext } from './fragment.ts'

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

export interface Dialect {
  readonly name: string
  quoteIdentifier(identifier: string): string
  placeholder(position: number): string
  readonly pagination?: DialectPagination
}

export interface DialectOptions {
  readonly name: string
  readonly quoteIdentifier?: (identifier: string) => string
  readonly placeholder: (position: number) => string
  readonly pagination?: DialectPagination
}

const quoteIdentifier = (identifier: string) =>
  `"${identifier.replaceAll('"', '""')}` + '"'

/**
 * Create a dialect from the few rendering decisions that SQL builders need
 * to leave open. More involved syntax can be supplied as a custom fragment.
 */
export function createDialect(options: DialectOptions): Dialect {
  return Object.freeze({
    name: options.name,
    quoteIdentifier: options.quoteIdentifier ?? quoteIdentifier,
    placeholder: options.placeholder,
    pagination: options.pagination,
  })
}
