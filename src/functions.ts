import { SQL } from './core.ts'

/**
 * Aggregate function that counts the number of rows, or if an
 * expression is provided, counts the number of rows where the
 * expression is `NOT NULL`.
 */
export function count(expr?: SQL.Part) {
  if (expr !== undefined) {
    return new SQL.Expression<number>([seq(['count(', expr, ')'], empty)])
  }
  return new SQL.Expression<number>(['count(*)'])
}
