export interface Dialect {
  readonly name: string
  quoteIdentifier(identifier: string): string
  placeholder(position: number): string
}

export interface DialectOptions {
  readonly name: string
  readonly quoteIdentifier?: (identifier: string) => string
  readonly placeholder: (position: number) => string
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
  })
}
