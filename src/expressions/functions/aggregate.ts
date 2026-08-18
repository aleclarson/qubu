import {
  makeExpression,
  type AnyExpression,
  type ExpressionWithOutput,
  type ResultExpression,
} from '../types.ts'
import { call } from './call.ts'

export function count(): ResultExpression<number, never, 'function', never>
export function count<TExpression extends AnyExpression>(
  expression: TExpression
): ResultExpression<number, TExpression, 'function', never>
export function count(expression?: AnyExpression) {
  return makeExpression('function', context => {
    context.append('COUNT(')
    if (expression) {
      context.render(expression)
    } else {
      context.append('*')
    }
    context.append(')')
  }) as ResultExpression<number, AnyExpression, 'function', never>
}

export function countDistinct<TExpression extends AnyExpression>(
  expression: TExpression
) {
  return makeExpression('function', context => {
    context.append('COUNT(DISTINCT ')
    context.render(expression)
    context.append(')')
  }) as ResultExpression<number, TExpression, 'function', never>
}

export function sum<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression
) {
  return call<T, 'SUM', [TExpression]>('SUM', expression)
}

export function average<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression
) {
  return call<number, 'AVG', [TExpression]>('AVG', expression)
}

export const avg = average

export function minimum<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression
) {
  return call<T, 'MIN', [TExpression]>('MIN', expression)
}

export const min = minimum

export function maximum<T, TExpression extends ExpressionWithOutput<T>>(
  expression: TExpression
) {
  return call<T, 'MAX', [TExpression]>('MAX', expression)
}

export const max = maximum
