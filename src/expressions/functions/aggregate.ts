import {
  makeExpression,
  type AggregateResultExpression,
  type AnyExpression,
  type ExpressionWithOutput,
  type ExpressionOutput,
  type ExpressionSqlType,
} from '../types.ts'
import { call } from './call.ts'
import type {
  SqlDecimal,
  SqlInteger,
  SqlNumericLike,
  SqlOrderable,
} from '../../core/sql-types.ts'
import type { SqlCapabilityValidation } from '../operators/shared.ts'
import type { NullabilityOf } from '../../core/fragment.ts'

export function count(): AggregateResultExpression<
  number,
  never,
  'function',
  never,
  SqlInteger
>
export function count<TExpression extends AnyExpression>(
  expression: TExpression
): AggregateResultExpression<number, TExpression, 'function', never, SqlInteger>
export function count(expression?: AnyExpression) {
  return makeExpression('function', context => {
    context.append('COUNT(')
    if (expression) {
      context.render(expression)
    } else {
      context.append('*')
    }
    context.append(')')
  }) as AggregateResultExpression<
    number,
    AnyExpression,
    'function',
    never,
    SqlInteger
  >
}

export function countDistinct<TExpression extends AnyExpression>(
  expression: TExpression
) {
  return makeExpression('function', context => {
    context.append('COUNT(DISTINCT ')
    context.render(expression)
    context.append(')')
  }) as AggregateResultExpression<
    number,
    TExpression,
    'function',
    never,
    SqlInteger
  >
}

export function sum<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression &
    SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlNumericLike>
) {
  return call<ExpressionOutput<TExpression>, 'SUM', [TExpression]>(
    'SUM',
    expression
  ) as AggregateResultExpression<
    ExpressionOutput<TExpression>,
    TExpression,
    'function',
    NullabilityOf<TExpression>,
    ExpressionSqlType<TExpression>
  >
}

export function average<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression &
    SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlNumericLike>
) {
  return call<number, 'AVG', [TExpression]>(
    'AVG',
    expression
  ) as AggregateResultExpression<
    number,
    TExpression,
    'function',
    NullabilityOf<TExpression>,
    SqlDecimal
  >
}

export const avg = average

export function minimum<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression &
    SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlOrderable>
) {
  return call<ExpressionOutput<TExpression>, 'MIN', [TExpression]>(
    'MIN',
    expression
  ) as AggregateResultExpression<
    ExpressionOutput<TExpression>,
    TExpression,
    'function',
    NullabilityOf<TExpression>,
    ExpressionSqlType<TExpression>
  >
}

export const min = minimum

export function maximum<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression &
    SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlOrderable>
) {
  return call<ExpressionOutput<TExpression>, 'MAX', [TExpression]>(
    'MAX',
    expression
  ) as AggregateResultExpression<
    ExpressionOutput<TExpression>,
    TExpression,
    'function',
    NullabilityOf<TExpression>,
    ExpressionSqlType<TExpression>
  >
}

export const max = maximum
