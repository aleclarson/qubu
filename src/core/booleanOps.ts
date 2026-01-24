import { assert } from 'radashi'
import { sql, SQL } from './sql.ts'
import { unsafe } from './tokens.ts'
import { boolean } from './type.ts'

// prettier-ignore
export const booleanOperatorRegistry = {
  "=": 1, "!=": 1, ">": 1, ">=": 1, "<": 1, "<=": 1, "in": 1, "not in": 1,
  "like": 1, "not like": 1, "ilike": 1, "not ilike": 1, "between": 1,
  "not between": 1,
} as const

type BuiltinBooleanOps = Record<keyof typeof booleanOperatorRegistry, number>

export interface BooleanOperatorRegistry extends BuiltinBooleanOps {}

export type BooleanOperator = keyof BooleanOperatorRegistry

/**
 * Compare two values.
 * @example
 * ```ts
 * is(users.id, '=', 1)
 * // users.id = 1
 * ```
 */
export function is(
  left: SQL.Part,
  op: BooleanOperator,
  right: SQL.Part
): SQL.Expression<boolean> {
  return sql(
    left,
    booleanOperatorRegistry[op] || assert(false, 'Invalid boolean operator'),
    right
  ).mapWith(boolean)
}

/** The `not` operator. */
export function not(value: SQL.Part): SQL.Expression<boolean> {
  return sql(unsafe('not'), value).mapWith(boolean)
}
