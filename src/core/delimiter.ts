import { assert } from 'radashi'
import { PgSyntax } from './symbols.ts'
import type { Token } from './tokens.ts'
import { unsafeMap } from './unsafe.ts'

// prettier-ignore
export const DelimiterRegistry = unsafeMap(
  '', ' ', ', ', '.',
  'and', 'or',
)

type BuiltinDelimiters = Record<keyof typeof DelimiterRegistry, Token.Syntax>

export interface DelimiterRegistry extends BuiltinDelimiters {}

export type Delimiter = keyof DelimiterRegistry | Token.Syntax

export const validateDelimiter = (delimiter: Delimiter) =>
  typeof delimiter === 'string'
    ? DelimiterRegistry[delimiter] || assert(false, 'Invalid delimiter')
    : delimiter

export function compareDelimiters(left: Delimiter, right: Delimiter) {
  const leftStr = typeof left === 'string' ? left : left[PgSyntax]
  const rightStr = typeof right === 'string' ? right : right[PgSyntax]
  return leftStr === rightStr
}
