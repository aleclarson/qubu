import type { NullabilityOf } from "../../core/fragment.ts"
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
 * Current types do not add `null` for empty input sets or model database aggregate widening.
 * Account for those cases with COALESCE, driver configuration, or an explicit result decoder.
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
    readonly nullableFrom: NullabilityOf<TExpression>
    readonly sqlType: ExpressionSqlType<TExpression>
  }>
}

/**
 * Average a numeric expression with a declared `number` output and SqlDecimal domain. Empty-input
 * nullability and driver string/decimal conversion are not inferred; see {@link sum}.
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
    readonly output: number
    readonly children: TExpression
    readonly kind: "function"
    readonly nullableFrom: NullabilityOf<TExpression>
    readonly sqlType: SqlDecimal
  }>
}

/** Return a minimum with the input's type and domain; empty-input nullability is not added. */
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
    readonly nullableFrom: NullabilityOf<TExpression>
    readonly sqlType: ExpressionSqlType<TExpression>
  }>
}

/** Return a maximum with the input's type and domain; empty-input nullability is not added. */
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
    readonly nullableFrom: NullabilityOf<TExpression>
    readonly sqlType: ExpressionSqlType<TExpression>
  }>
}
