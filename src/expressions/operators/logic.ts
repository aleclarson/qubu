import { makeSchemaExpression, type ResultExpression } from '../types.ts'
import type { BooleanExpression } from './comparison.ts'
import { renderOperands, type SqlCapabilityValidation } from './shared.ts'
import { omit, type Omit } from '../../query/omit.ts'
import type { SqlBoolean } from '../../core/sql-types.ts'
import type { NullabilityOf } from '../../core/fragment.ts'
import type { ExpressionSqlType } from '../types.ts'

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
      | ResultExpression<
          boolean,
          PresentConditions<TConditions>,
          'operator',
          NullabilityOf<PresentConditions<TConditions>>,
          SqlBoolean
        >
      | (Omit extends TConditions[number] ? Omit : never)

type BooleanConditionsValidation<TConditions extends readonly unknown[]> =
  TConditions extends readonly [infer THead, ...infer TTail]
    ? (THead extends Omit
        ? unknown
        : SqlCapabilityValidation<ExpressionSqlType<THead>, SqlBoolean>) &
        BooleanConditionsValidation<TTail>
    : unknown

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

  return makeSchemaExpression('operator', context => {
    context.append('(')
    renderOperands(context, presentConditions, separator)
    context.append(')')
  }) as BooleanComposition<TConditions>
}

export function and<const TConditions extends readonly BooleanOperand[]>(
  ...conditions: TConditions & BooleanConditionsValidation<TConditions>
): BooleanComposition<TConditions> {
  return composeConditions<TConditions>(conditions, ' AND ', 'and')
}

export function or<const TConditions extends readonly BooleanOperand[]>(
  ...conditions: TConditions & BooleanConditionsValidation<TConditions>
): BooleanComposition<TConditions> {
  return composeConditions<TConditions>(conditions, ' OR ', 'or')
}

export function not<TCondition extends BooleanExpression<any>>(
  condition: TCondition &
    SqlCapabilityValidation<ExpressionSqlType<TCondition>, SqlBoolean>
) {
  return makeSchemaExpression('operator', context => {
    context.append('(NOT ')
    context.render(condition)
    context.append(')')
  }) as ResultExpression<
    boolean,
    TCondition,
    'operator',
    NullabilityOf<TCondition>,
    SqlBoolean
  >
}
