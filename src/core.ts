import { sql, SQL } from './core/sql.ts'
import { empty, seq, unsafe } from './core/tokens.ts'
import { boolean } from './core/type.ts'

export * from './core/booleanOps.ts'
export * from './core/casing.ts'
export * from './core/mathOps.ts'
export * from './core/sql.ts'
export * from './core/tokens.ts'
export * from './core/type.ts'

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

/**
 * The `and` operator.
 *
 * @example
 * ```ts
 * query.where(x.is('!=', 0), and(y.is('!=', 0)), and(z.is('!=', 0)))
 * // WHERE x != 0 AND y != 0 AND z != 0
 * ```
 */
export function and(...parts: SQL.Part[]) {
  return new SQL.Component('and').$append(parts)
}

/**
 * Concatenate parts with the `and` operator. Empty parts are omitted.
 *
 * @example
 * ```ts
 * and.seq([x.is('!=', 0), y.is('!=', 0), z.is('!=', 0)])
 * // x != 0 AND y != 0 AND z != 0
 * ```
 */
and.seq = (parts: readonly SQL.Part[]) =>
  sql(seq(parts, unsafe('and'))).mapWith(boolean)

/**
 * The `or` operator.
 *
 * @example
 * ```ts
 * query.where(x.is('!=', 0), or(y.is('!=', 0)), or(z.is('!=', 0)))
 * // WHERE x != 0 OR y != 0 OR z != 0
 * ```
 */
export function or(...parts: SQL.Part[]) {
  return new SQL.Component('or').$append(parts)
}

/**
 * Concatenate parts with the `or` operator. Empty parts are omitted.
 *
 * @example
 * ```ts
 * or.seq([x.is('!=', 0), y.is('!=', 0), z.is('!=', 0)])
 * // x != 0 OR y != 0 OR z != 0
 * ```
 */
or.seq = (parts: readonly SQL.Part[]) =>
  sql(seq(parts, unsafe('or'))).mapWith(boolean)

/** The `not` operator. */
export function not(...parts: SQL.Part[]) {
  return sql(unsafe('not'), ...parts).mapWith(boolean)
}
