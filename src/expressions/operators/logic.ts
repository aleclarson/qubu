import { makeExpression, type ResultExpression } from '../types.ts'
import type { BooleanExpression } from './comparison.ts'
import { renderOperands } from './shared.ts'

export function and<const TConditions extends readonly BooleanExpression[]>(
  ...conditions: TConditions
) {
  if (conditions.length === 0) {
    throw new Error('and() requires at least one condition')
  }

  return makeExpression('operator', context => {
    context.append('(')
    renderOperands(context, conditions, ' AND ')
    context.append(')')
  }) as ResultExpression<boolean, TConditions[number], 'operator'>
}

export function or<const TConditions extends readonly BooleanExpression[]>(
  ...conditions: TConditions
) {
  if (conditions.length === 0) {
    throw new Error('or() requires at least one condition')
  }

  return makeExpression('operator', context => {
    context.append('(')
    renderOperands(context, conditions, ' OR ')
    context.append(')')
  }) as ResultExpression<boolean, TConditions[number], 'operator'>
}

export function not<TCondition extends BooleanExpression<any>>(
  condition: TCondition
) {
  return makeExpression('operator', context => {
    context.append('(NOT ')
    context.render(condition)
    context.append(')')
  }) as ResultExpression<boolean, TCondition, 'operator'>
}
