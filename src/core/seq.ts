import { assert } from 'radashi'
import { SQL } from './sql.ts'
import { PgSequence, PgSyntax, SequenceDelimiter } from './symbols.ts'
import { Token, tokenize, unsafeMap } from './tokens.ts'

// prettier-ignore
export const delimiterRegistry = unsafeMap(
  '', ' ', ', ', '.',
  'and', 'or',
)

type BuiltinDelimiters = Record<keyof typeof delimiterRegistry, Token.Syntax>

export interface DelimiterRegistry extends BuiltinDelimiters {}

export type Delimiter = keyof DelimiterRegistry | Token.Syntax

/**
 * A sequence of SQL parts by a given delimiter (space by default).
 */
export function seq(
  parts: readonly SQL.Part[],
  delimiter: Delimiter = ' '
): Token.Sequence {
  return {
    [PgSequence]: tokenize(parts, [], delimiter),
    [SequenceDelimiter]: validateDelimiter(delimiter),
  }
}

export function validateDelimiter(delimiter: Delimiter) {
  return typeof delimiter === 'string'
    ? delimiterRegistry[delimiter] || assert(false, 'Invalid delimiter')
    : delimiter
}

export function compareDelimiters(left: Delimiter, right: Delimiter) {
  const leftStr = typeof left === 'string' ? left : left[PgSyntax]
  const rightStr = typeof right === 'string' ? right : right[PgSyntax]
  return leftStr === rightStr
}
