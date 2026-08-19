import { makeExpression, type ResultExpression } from '../types.ts'
import type { BooleanExpression } from './comparison.ts'
import { renderOperands } from './shared.ts'
import { omit, type Omit } from '../../query/omit.ts'

type BooleanOperand = BooleanExpression<any> | Omit
type PresentConditions<TConditions extends readonly BooleanOperand[]> = Exclude<
  TConditions[number],
  Omit
>
type BooleanComposition<TConditions extends readonly BooleanOperand[]> = [
  PresentConditions<TConditions>,
] extends [never]
  ? Omit
  :
      | ResultExpression<boolean, PresentConditions<TConditions>, 'operator'>
      | (Omit extends TConditions[number] ? Omit : never)

function composeConditions<const TConditions extends readonly BooleanOperand[]>(
  conditions: TConditions,
  separator: string,
  name: string
): BooleanComposition<TConditions> {
  if (conditions.length === 0) {
    throw new Error(`${name}() requires at least one condition`)
  }

  const presentConditions = conditions.filter(
    (condition): condition is PresentConditions<TConditions> =>
      condition !== omit
  )
  if (presentConditions.length === 0)
    return omit as BooleanComposition<TConditions>

  return makeExpression('operator', context => {
    context.append('(')
    renderOperands(context, presentConditions, separator)
    context.append(')')
  }) as BooleanComposition<TConditions>
}

export function and<const TConditions extends readonly BooleanOperand[]>(
  ...conditions: TConditions
): BooleanComposition<TConditions> {
  return composeConditions(conditions, ' AND ', 'and')
}

export function or<const TConditions extends readonly BooleanOperand[]>(
  ...conditions: TConditions
): BooleanComposition<TConditions> {
  return composeConditions(conditions, ' OR ', 'or')
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
