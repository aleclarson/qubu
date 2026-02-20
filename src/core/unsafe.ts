import { UnionToIntersection } from 'type-fest'
import { PgSyntax } from './symbols.ts'
import type { Token } from './tokens.ts'

/**
 * An escape hatch for raw SQL.
 */
export const unsafe = <T extends string>(syntax: T): Token.Syntax<T> => ({
  [PgSyntax]: syntax,
})

/**
 * Create a map of `unsafe()` tokens.
 */
export const unsafeMap = <T extends string>(
  ...tokens: readonly T[]
): UnionToIntersection<
  T extends string ? { [K in T]: Token.Syntax<T> } : never
> =>
  tokens.reduce((acc, token) => {
    acc[token] = unsafe(token)
    return acc
  }, {} as any)
