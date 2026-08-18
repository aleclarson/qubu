import {
  makeExpression,
  type AggregateResultExpression,
  type AnyExpression,
  type ExpressionWithOutput,
  type ExpressionOutput,
} from '../types.ts'
import { call } from './call.ts'

export function count(): AggregateResultExpression<
  number,
  never,
  'function',
  never
>
export function count<TExpression extends AnyExpression>(
  expression: TExpression
): AggregateResultExpression<number, TExpression, 'function', never>
export function count(expression?: AnyExpression) {
  return makeExpression('function', context => {
    context.append('COUNT(')
    if (expression) {
      context.render(expression)
    } else {
      context.append('*')
    }
    context.append(')')
  }) as AggregateResultExpression<number, AnyExpression, 'function', never>
}

export function countDistinct<TExpression extends AnyExpression>(
  expression: TExpression
) {
  return makeExpression('function', context => {
    context.append('COUNT(DISTINCT ')
    context.render(expression)
    context.append(')')
  }) as AggregateResultExpression<number, TExpression, 'function', never>
}

export function sum<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression
) {
  return call<ExpressionOutput<TExpression>, 'SUM', [TExpression]>(
    'SUM',
    expression
  ) as AggregateResultExpression<
    ExpressionOutput<TExpression>,
    TExpression,
    'function'
  >
}

export function average<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression
) {
  return call<number, 'AVG', [TExpression]>(
    'AVG',
    expression
  ) as AggregateResultExpression<number, TExpression, 'function'>
}

export const avg = average

export function minimum<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression
) {
  return call<ExpressionOutput<TExpression>, 'MIN', [TExpression]>(
    'MIN',
    expression
  ) as AggregateResultExpression<
    ExpressionOutput<TExpression>,
    TExpression,
    'function'
  >
}

export const min = minimum

export function maximum<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression
) {
  return call<ExpressionOutput<TExpression>, 'MAX', [TExpression]>(
    'MAX',
    expression
  ) as AggregateResultExpression<
    ExpressionOutput<TExpression>,
    TExpression,
    'function'
  >
}

export const max = maximum
