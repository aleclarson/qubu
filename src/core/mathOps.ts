import { assert } from 'radashi'
import { sql, SQL } from './sql.ts'
import { unsafe } from './tokens.ts'

// prettier-ignore
export const MathOps = {
  "+": 1, "-": 1, "*": 1, "/": 1, "%": 1, "**": 1,
  "^": 1, "|/": 1, "||/": 1, "@": 1, "&": 1, "|": 1,
  "#": 1, "~": 1, "<<": 1, ">>": 1,
} as const

type DefaultMathOps = Record<keyof typeof MathOps, number>

export interface MathOps extends DefaultMathOps {}

type MathPrimitive = number | bigint | null | undefined

type MathPart =
  | Exclude<SQL.Part, SQL.Primitive | readonly SQL.Part[]>
  | MathPrimitive
  | keyof MathOps
  | readonly MathPart[]

/**
 * Calculate a math expression. Math operators can be used without
 * `unsafe()`.
 * @example
 * ```ts
 * calc(2, '**', [1, '+', 3])
 * // 2 ** (1 + 3)
 * ```
 */
export function calc(...parts: MathPart[]): SQL.Expression<number> {
  return sql.fromArray(
    parts.map(part => {
      if (typeof part === 'number' || typeof part === 'bigint') {
        return part
      }
      if (typeof part === 'string') {
        assert(MathOps[part], 'Invalid math operator')
        return unsafe(part)
      }
      if (Array.isArray(part)) {
        return [calc(...part)]
      }
      return part
    })
  )
}
