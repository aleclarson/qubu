import { sequence, sql, SQL, unsafe } from './core.ts'
import { boolean } from './data/boolean.ts'

function binaryOperator<T = unknown>(
  text: string,
  type: SQL.Type<string, any, T> | null = null
) {
  const token = unsafe(text)
  return (a: SQL.Part, b?: SQL.Part) =>
    sql(
      b === undefined ? sequence([token, a]) : sequence([a, token, b])
    ).mapWith(type)
}

function suffixOperator<T = unknown>(
  text: string,
  type?: SQL.Type<string, any, T>
) {
  const token = unsafe(text)
  return (a?: SQL.Part) =>
    a === undefined ? token : sql(sequence([a, token])).mapWith(type ?? null)
}

function prefixOperator<T = unknown>(
  text: string,
  type: SQL.Type<string, any, T>
) {
  const token = unsafe(text)
  return (a?: SQL.Part) =>
    a === undefined ? token : sql(sequence([token, a])).mapWith(type)
}

/** The `=` operator. */
export const isEqual = binaryOperator('=', boolean)
/** The `!=` operator. */
export const isNotEqual = binaryOperator('!=', boolean)
/** The `>` operator. */
export const isGreaterThan = binaryOperator('>', boolean)
/** The `>=` operator. */
export const isGreaterThanOrEqual = binaryOperator('>=', boolean)
/** The `<` operator. */
export const isLessThan = binaryOperator('<', boolean)
/** The `<=` operator. */
export const isLessThanOrEqual = binaryOperator('<=', boolean)
/** The `in` operator. */
export const isIn = binaryOperator('in', boolean)
/** The `not in` operator. */
export const isNotIn = binaryOperator('not in', boolean)
/** The `like` operator. */
export const isLike = binaryOperator('like', boolean)
/** The `not like` operator. */
export const isNotLike = binaryOperator('not like', boolean)
/** The `ilike` operator. */
export const isILike = binaryOperator('ilike', boolean)
/** The `not ilike` operator. */
export const isNotILike = binaryOperator('not ilike', boolean)
/** The `is null` operator. */
export const isNull = suffixOperator('is null', boolean)
/** The `is not null` operator. */
export const isNotNull = suffixOperator('is not null', boolean)
/** The `and` operator. */
export const and = binaryOperator('and', boolean)
/** The `or` operator. */
export const or = binaryOperator('or', boolean)
/** The `not` operator. */
export const not = prefixOperator('not', boolean)

/**
 * Ascending sort order. Append an `asc` modifier to the SQL object.
 */
export const asc = suffixOperator('asc')

/**
 * Descending sort order. Append a `desc` modifier to the SQL object.
 */
export const desc = suffixOperator('desc')

/**
 * Rows where the preceding expression is `null` should come first.
 * This is the default behavior for "descending" sort order.
 */
export const nullsFirst = suffixOperator('nulls first')

/**
 * Rows where the preceding expression is `null` should come last.
 * This is the default behavior for "ascending" sort order.
 */
export const nullsLast = suffixOperator('nulls last')
