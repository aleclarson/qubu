import type { EmptyAggregateInput, NullabilityOf } from "../../core/fragment.ts"
import type { SqlDecimal, SqlInteger, SqlNumericLike, SqlOrderable } from "../../core/sql-types.ts"
import { attachResultValue, resultValue, resultValueOf } from "../../result.ts"
import type { SqlCapabilityValidation } from "../operators/shared.ts"
import {
  makeExpression,
  markExpressionCategory,
  type AggregateResultExpression,
  type AnyExpression,
  type ExpressionWithOutput,
  type ExpressionOutput,
  type ExpressionSqlType,
} from "../types.ts"
import { call } from "./call.ts"

/**
 * Count rows, or non-null values when passed an expression, with a non-null numeric contract.
 * Driver strings are not automatically converted to numbers; configure the driver or mapResult().
 */
export function count(): AggregateResultExpression<{
  readonly output: number
  readonly kind: "function"
  readonly nullableFrom: never
  readonly sqlType: SqlInteger
}>
export function count<TExpression extends AnyExpression>(
  expression: TExpression,
): AggregateResultExpression<{
  readonly output: number
  readonly children: TExpression
  readonly kind: "function"
  readonly nullableFrom: never
  readonly sqlType: SqlInteger
}>
export function count(expression?: AnyExpression) {
  return makeExpression(
    "function",
    (context) => {
      context.append("COUNT(")
      if (expression) {
        context.render(expression)
      } else {
        context.append("*")
      }

      context.append(")")
    },
    "aggregate",
    resultValue(undefined, undefined, "integer"),
  ) as AggregateResultExpression<{
    readonly output: number
    readonly children: AnyExpression
    readonly kind: "function"
    readonly nullableFrom: never
    readonly sqlType: SqlInteger
  }>
}

/** Count distinct non-null values, with the same driver-value caveat as {@link count}. */
export function countDistinct<TExpression extends AnyExpression>(expression: TExpression) {
  return makeExpression(
    "function",
    (context) => {
      context.append("COUNT(DISTINCT ")
      context.render(expression)
      context.append(")")
    },
    "aggregate",
    resultValue(undefined, undefined, "integer"),
  ) as AggregateResultExpression<{
    readonly output: number
    readonly children: TExpression
    readonly kind: "function"
    readonly nullableFrom: never
    readonly sqlType: SqlInteger
  }>
}

/**
 * Sum a numeric expression while retaining its declared output type and SQL domain.
 *
 * SELECT adds `null` when input can be empty. GROUP BY groups and supported inline windows contain
 * rows, but nullable arguments or outer joins can still make the result null. Database aggregate
 * widening and driver wire-value conversion are not inferred.
 */
export function sum<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlNumericLike>,
) {
  return markExpressionCategory(
    attachResultValue(
      call<ExpressionOutput<TExpression>, "SUM", [TExpression]>("SUM", expression),
      resultValueOf(expression),
    ),
    "aggregate",
  ) as AggregateResultExpression<{
    readonly output: ExpressionOutput<TExpression>
    readonly children: TExpression
    readonly kind: "function"
    readonly nullableFrom: NullabilityOf<TExpression> | EmptyAggregateInput
    readonly sqlType: ExpressionSqlType<TExpression>
  }>
}

/**
 * Average a numeric expression with a numeric output and SqlDecimal domain. SELECT adds `null` for
 * empty input or nullable arguments; see {@link sum} for grouping and driver-value boundaries.
 */
export function avg<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlNumericLike>,
) {
  return markExpressionCategory(
    attachResultValue(
      call<number, "AVG", [TExpression]>("AVG", expression),
      resultValue(undefined, undefined, "decimal"),
    ),
    "aggregate",
  ) as AggregateResultExpression<{
    readonly output: number | (null extends ExpressionOutput<TExpression> ? null : never)
    readonly children: TExpression
    readonly kind: "function"
    readonly nullableFrom: NullabilityOf<TExpression> | EmptyAggregateInput
    readonly sqlType: SqlDecimal
  }>
}

/** Return a minimum with the input's type and domain, nullable for empty input; see {@link sum}. */
export function min<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlOrderable>,
) {
  return markExpressionCategory(
    attachResultValue(
      call<ExpressionOutput<TExpression>, "MIN", [TExpression]>("MIN", expression),
      resultValueOf(expression),
    ),
    "aggregate",
  ) as AggregateResultExpression<{
    readonly output: ExpressionOutput<TExpression>
    readonly children: TExpression
    readonly kind: "function"
    readonly nullableFrom: NullabilityOf<TExpression> | EmptyAggregateInput
    readonly sqlType: ExpressionSqlType<TExpression>
  }>
}

/** Return a maximum with the input's type and domain, nullable for empty input; see {@link sum}. */
export function max<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlOrderable>,
) {
  return markExpressionCategory(
    attachResultValue(
      call<ExpressionOutput<TExpression>, "MAX", [TExpression]>("MAX", expression),
      resultValueOf(expression),
    ),
    "aggregate",
  ) as AggregateResultExpression<{
    readonly output: ExpressionOutput<TExpression>
    readonly children: TExpression
    readonly kind: "function"
    readonly nullableFrom: NullabilityOf<TExpression> | EmptyAggregateInput
    readonly sqlType: ExpressionSqlType<TExpression>
  }>
}
