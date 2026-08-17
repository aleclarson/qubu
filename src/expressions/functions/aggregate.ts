import {
  makeExpression,
  type AnyExpression,
  type Expression,
} from '../types.ts'
import { call } from './call.ts'
import {
  type OperandParameters,
  type OperandRequires,
} from '../operators/shared.ts'

export function count<TExpression extends AnyExpression>(
  expression?: TExpression
) {
  return makeExpression('function', context => {
    context.append('COUNT(')
    if (expression) {
      context.render(expression)
    } else {
      context.append('*')
    }
    context.append(')')
  }) as Expression<
    number,
    TExpression extends AnyExpression ? OperandRequires<TExpression> : never,
    TExpression extends AnyExpression ? OperandParameters<TExpression> : never,
    'function'
  >
}

export function countDistinct<TExpression extends AnyExpression>(
  expression: TExpression
) {
  return makeExpression('function', context => {
    context.append('COUNT(DISTINCT ')
    context.render(expression)
    context.append(')')
  }) as Expression<
    number,
    OperandRequires<TExpression>,
    OperandParameters<TExpression>,
    'function'
  >
}

export function sum<T, TReq, TParams>(
  expression: Expression<T, TReq, TParams, any>
) {
  return call<T, 'SUM', [Expression<T, TReq, TParams, any>]>('SUM', expression)
}

export function average<T, TReq, TParams>(
  expression: Expression<T, TReq, TParams, any>
) {
  return call<number, 'AVG', [Expression<T, TReq, TParams, any>]>(
    'AVG',
    expression
  )
}

export const avg = average

export function minimum<T, TReq, TParams>(
  expression: Expression<T, TReq, TParams, any>
) {
  return call<T, 'MIN', [Expression<T, TReq, TParams, any>]>('MIN', expression)
}

export const min = minimum

export function maximum<T, TReq, TParams>(
  expression: Expression<T, TReq, TParams, any>
) {
  return call<T, 'MAX', [Expression<T, TReq, TParams, any>]>('MAX', expression)
}

export const max = maximum
