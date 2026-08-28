import type { NullabilityOf } from "../../core/fragment.ts"
import type { SqlDecimal, SqlInteger, SqlNumericLike, SqlOrderable } from "../../core/sql-types.ts"
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
  ) as AggregateResultExpression<{
    readonly output: number
    readonly children: AnyExpression
    readonly kind: "function"
    readonly nullableFrom: never
    readonly sqlType: SqlInteger
  }>
}

export function countDistinct<TExpression extends AnyExpression>(expression: TExpression) {
  return makeExpression(
    "function",
    (context) => {
      context.append("COUNT(DISTINCT ")
      context.render(expression)
      context.append(")")
    },
    "aggregate",
  ) as AggregateResultExpression<{
    readonly output: number
    readonly children: TExpression
    readonly kind: "function"
    readonly nullableFrom: never
    readonly sqlType: SqlInteger
  }>
}

export function sum<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlNumericLike>,
) {
  return markExpressionCategory(
    call<ExpressionOutput<TExpression>, "SUM", [TExpression]>("SUM", expression),
    "aggregate",
  ) as AggregateResultExpression<{
    readonly output: ExpressionOutput<TExpression>
    readonly children: TExpression
    readonly kind: "function"
    readonly nullableFrom: NullabilityOf<TExpression>
    readonly sqlType: ExpressionSqlType<TExpression>
  }>
}

export function avg<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlNumericLike>,
) {
  return markExpressionCategory(
    call<number, "AVG", [TExpression]>("AVG", expression),
    "aggregate",
  ) as AggregateResultExpression<{
    readonly output: number
    readonly children: TExpression
    readonly kind: "function"
    readonly nullableFrom: NullabilityOf<TExpression>
    readonly sqlType: SqlDecimal
  }>
}

export function min<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlOrderable>,
) {
  return markExpressionCategory(
    call<ExpressionOutput<TExpression>, "MIN", [TExpression]>("MIN", expression),
    "aggregate",
  ) as AggregateResultExpression<{
    readonly output: ExpressionOutput<TExpression>
    readonly children: TExpression
    readonly kind: "function"
    readonly nullableFrom: NullabilityOf<TExpression>
    readonly sqlType: ExpressionSqlType<TExpression>
  }>
}

export function max<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlOrderable>,
) {
  return markExpressionCategory(
    call<ExpressionOutput<TExpression>, "MAX", [TExpression]>("MAX", expression),
    "aggregate",
  ) as AggregateResultExpression<{
    readonly output: ExpressionOutput<TExpression>
    readonly children: TExpression
    readonly kind: "function"
    readonly nullableFrom: NullabilityOf<TExpression>
    readonly sqlType: ExpressionSqlType<TExpression>
  }>
}
