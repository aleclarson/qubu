import { assert } from 'radashi'
import { sql, SQL } from './sql.ts'
import { boolean } from './type.ts'
import { unsafe, unsafeMap } from './unsafe.ts'

// prettier-ignore
export const BooleanOperatorRegistry = unsafeMap(
  "=", "!=", ">", ">=", "<", "<=", "in", "not in",
  "like", "not like", "ilike", "not ilike", "between",
  "not between",
)

type BuiltinBooleanOps = Record<keyof typeof BooleanOperatorRegistry, number>

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
    BooleanOperatorRegistry[op] || assert(false, 'Invalid boolean operator'),
    right
  ).mapWith(boolean)
}

/** The `not` operator. */
export function not(value: SQL.Part): SQL.Expression<boolean> {
  return sql(unsafe('not'), value).mapWith(boolean)
}
