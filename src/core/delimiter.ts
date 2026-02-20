import { assert } from 'radashi'
import { PgSyntax } from './symbols.ts'
import type { Token } from './tokens.ts'
import { unsafeMap } from './unsafe.ts'

// prettier-ignore
export const delimiterRegistry = unsafeMap(
  '', ' ', ', ', '.',
  'and', 'or',
)

type BuiltinDelimiters = Record<keyof typeof delimiterRegistry, Token.Syntax>

export interface DelimiterRegistry extends BuiltinDelimiters {}

export type Delimiter = keyof DelimiterRegistry | Token.Syntax

export const validateDelimiter = (delimiter: Delimiter) =>
  typeof delimiter === 'string'
    ? delimiterRegistry[delimiter] || assert(false, 'Invalid delimiter')
    : delimiter

export function compareDelimiters(left: Delimiter, right: Delimiter) {
  const leftStr = typeof left === 'string' ? left : left[PgSyntax]
  const rightStr = typeof right === 'string' ? right : right[PgSyntax]
  return leftStr === rightStr
}
