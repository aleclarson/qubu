import { SQL } from './core/sql.ts'
import { empty } from './core/tokens.ts'

export * from './core/booleanOps.ts'
export * from './core/casing.ts'
export * from './core/mathOps.ts'
export * from './core/sql.ts'
export * from './core/tokens.ts'
export * from './core/type.ts'
export * from './core/unsafe.ts'

export * from './definition/column.ts'
export * from './definition/table.ts'

export * from './functions.ts'

/**
 * Useful for conditional syntax. If the condition is falsy, exclude
 * the given syntax from the query.
 *
 * ⚠️ The `condition` is JavaScript, not SQL. Use `caseWhen()` for SQL
 * conditions.
 *
 * @example
 * ```ts
 * select(users.id, $if(isAdmin, users.email), users.name)
 * ```
 */
export function $if<T, Alias extends string>(
  condition: unknown,
  truthy: SQL.Expression<T, Alias>
): SQL.Expression<T | undefined, Alias> | typeof empty

export function $if<T extends SQL>(
  condition: unknown,
  truthy: T
): T | typeof empty

export function $if(condition: unknown, truthy: SQL): SQL | typeof empty {
  return condition ? truthy : empty
}
