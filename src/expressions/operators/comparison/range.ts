import { makeExpression } from '../../types.ts'
import {
  expressionOperand,
  type Operand,
  type OperandParameters,
  type OperandRequires,
} from '../shared.ts'
import type { BooleanExpression } from './types.ts'
import type { Expression } from '../../types.ts'

export function between<
  T,
  TReq,
  TParams,
  L extends Operand<T>,
  H extends Operand<T>,
>(expression: Expression<T, TReq, TParams, any>, lower: L, upper: H) {
  const lowerExpression = expressionOperand(lower)
  const upperExpression = expressionOperand(upper)
  return makeExpression('operator', context => {
    context.append('(')
    context.render(expression)
    context.append(' BETWEEN ')
    context.render(lowerExpression)
    context.append(' AND ')
    context.render(upperExpression)
    context.append(')')
  }) as BooleanExpression<
    TReq | OperandRequires<L> | OperandRequires<H>,
    TParams | OperandParameters<L> | OperandParameters<H>
  >
}

export function inList<
  T,
  TReq,
  TParams,
  const TValues extends readonly Operand<T>[],
>(expression: Expression<T, TReq, TParams, any>, values: TValues) {
  const valueExpressions = values.map(expressionOperand)
  return makeExpression('operator', context => {
    context.append('(')
    context.render(expression)
    context.append(' IN (')
    valueExpressions.forEach((value, index) => {
      if (index > 0) context.append(', ')
      context.render(value)
    })
    context.append('))')
  }) as BooleanExpression<
    TReq | OperandRequires<TValues[number]>,
    TParams | OperandParameters<TValues[number]>
  >
}

export function notIn<
  T,
  TReq,
  TParams,
  const TValues extends readonly Operand<T>[],
>(expression: Expression<T, TReq, TParams, any>, values: TValues) {
  const valueExpressions = values.map(expressionOperand)
  return makeExpression('operator', context => {
    context.append('(')
    context.render(expression)
    context.append(' NOT IN (')
    valueExpressions.forEach((value, index) => {
      if (index > 0) context.append(', ')
      context.render(value)
    })
    context.append('))')
  }) as BooleanExpression<
    TReq | OperandRequires<TValues[number]>,
    TParams | OperandParameters<TValues[number]>
  >
}
