import { assert } from 'radashi'
import { sql, SQL } from './sql.ts'
import { unsafeMap } from './unsafe.ts'

// prettier-ignore
export const MathOperatorRegistry = unsafeMap(
  "+", "-", "*", "/", "%", "**",
  "^", "|/", "||/", "@", "&", "|",
  "#", "~", "<<", ">>",
)

type BuiltinMathOps = Record<keyof typeof MathOperatorRegistry, number>

export interface MathOperatorRegistry extends BuiltinMathOps {}

export type MathOperator = keyof MathOperatorRegistry

type MathPrimitive = number | bigint | null | undefined

type MathPart =
  | Exclude<SQL.Part, SQL.Primitive | readonly SQL.Part[]>
  | MathPrimitive
  | MathOperator
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
  return sql(
    ...parts.map(part => {
      if (typeof part === 'number' || typeof part === 'bigint') {
        return part
      }
      if (typeof part === 'string') {
        return (
          MathOperatorRegistry[part] || assert(false, 'Invalid math operator')
        )
      }
      if (Array.isArray(part)) {
        return [calc(...part)]
      }
      return part
    })
  )
}
