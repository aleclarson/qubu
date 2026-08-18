import {
  makeExpression,
  type ExpressionWithOutput,
  type ResultExpression,
} from '../../types.ts'
import { expressionOperand, isNullOperand, type Operand } from '../shared.ts'

export function between<
  T,
  TExpression extends ExpressionWithOutput<T>,
  L extends Operand<NoInfer<T>>,
  H extends Operand<NoInfer<T>>,
>(expression: TExpression, lower: L, upper: H) {
  if (isNullOperand(lower) || isNullOperand(upper)) {
    throw new TypeError(
      'between() does not accept NULL bounds; use an explicit NULL predicate'
    )
  }
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
  }) as ResultExpression<boolean, TExpression | L | H, 'operator'>
}

export function inList<
  T,
  TExpression extends ExpressionWithOutput<T>,
  const TValues extends readonly Operand<NoInfer<T>>[],
>(expression: TExpression, values: TValues) {
  const valueExpressions = values.map(expressionOperand)
  return makeExpression('operator', context => {
    if (values.length === 0) {
      context.append('(1 = 0)')
      return
    }
    context.append('(')
    context.render(expression)
    context.append(' IN (')
    valueExpressions.forEach((value, index) => {
      if (index > 0) context.append(', ')
      context.render(value)
    })
    context.append('))')
  }) as ResultExpression<boolean, TExpression | TValues[number], 'operator'>
}

export function notIn<
  T,
  TExpression extends ExpressionWithOutput<T>,
  const TValues extends readonly Operand<NoInfer<T>>[],
>(expression: TExpression, values: TValues) {
  const valueExpressions = values.map(expressionOperand)
  return makeExpression('operator', context => {
    if (values.length === 0) {
      context.append('(1 = 1)')
      return
    }
    context.append('(')
    context.render(expression)
    context.append(' NOT IN (')
    valueExpressions.forEach((value, index) => {
      if (index > 0) context.append(', ')
      context.render(value)
    })
    context.append('))')
  }) as ResultExpression<boolean, TExpression | TValues[number], 'operator'>
}
