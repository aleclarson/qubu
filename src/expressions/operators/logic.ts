import { makeExpression } from '../types.ts'
import type { BooleanExpression } from './comparison.ts'
import {
  renderOperands,
  type ParametersOfOperands,
  type RequirementsOf,
} from './shared.ts'

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
  }) as BooleanExpression<
    RequirementsOf<TConditions>,
    ParametersOfOperands<TConditions>
  >
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
  }) as BooleanExpression<
    RequirementsOf<TConditions>,
    ParametersOfOperands<TConditions>
  >
}

export function not<TRequires, TParameters>(
  condition: BooleanExpression<TRequires, TParameters>
) {
  return makeExpression('operator', context => {
    context.append('(NOT ')
    context.render(condition)
    context.append(')')
  }) as BooleanExpression<TRequires, TParameters>
}
