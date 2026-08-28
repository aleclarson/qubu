import { makeSchemaExpression, type ResultExpression } from '../types.ts'
import type { BooleanExpression } from './comparison.ts'
import { renderOperands, type SqlCapabilityValidation } from './shared.ts'
import { omit, type Omit } from '../../query/omit.ts'
import type { SqlBoolean } from '../../core/sql-types.ts'
import type { NullabilityOf } from '../../core/fragment.ts'
import type { ExpressionSqlType } from '../types.ts'
import { queryValidationError } from '../../query/errors.ts'
import { resultValue } from '../../result.ts'

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
      | ResultExpression<{
          readonly output: boolean
          readonly children: PresentConditions<TConditions>
          readonly kind: 'operator'
          readonly nullableFrom: NullabilityOf<PresentConditions<TConditions>>
          readonly sqlType: SqlBoolean
        }>
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
    throw queryValidationError({
      code: 'invalid-boolean-expression',
      context: `expression.${name}`,
      path: [name],
      message: `${name}() requires at least one condition`,
      hint: `Pass at least one condition to ${name}(), or use omit for a conditional predicate.`,
    })
  }

  const presentConditions = conditions.filter(
    (condition): condition is PresentConditions<TConditions> =>
      condition !== omit
  )
  if (presentConditions.length === 0)
    return omit as BooleanComposition<TConditions>

  return makeSchemaExpression(
    'operator',
    context => {
      context.append('(')
      renderOperands(context, presentConditions, separator)
      context.append(')')
    },
    resultValue('boolean')
  ) as BooleanComposition<TConditions>
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
  return makeSchemaExpression(
    'operator',
    context => {
      context.append('(NOT ')
      context.render(condition)
      context.append(')')
    },
    resultValue('boolean')
  ) as ResultExpression<{
    readonly output: boolean
    readonly children: TCondition
    readonly kind: 'operator'
    readonly nullableFrom: NullabilityOf<TCondition>
    readonly sqlType: SqlBoolean
  }>
}
