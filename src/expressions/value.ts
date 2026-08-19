import { parameter } from '../core/primitives/parameter.ts'
import { makeExpression, type AnyExpression, type Expression } from './types.ts'
import type { ExpressionMeta, ResultMeta } from '../core/fragment.ts'
import type { AnySqlType, SqlUnknown } from '../core/sql-types.ts'

export interface ValueExpression<
  T = unknown,
  TSqlType extends AnySqlType = SqlUnknown,
> extends Expression<
    ResultMeta<T, never, TSqlType> | ExpressionMeta<never>,
    'value'
  > {
  readonly value: T
}

export function value<T>(input: T): ValueExpression<T> {
  const expression = makeExpression<
    ResultMeta<T> | ExpressionMeta<never>,
    'value'
  >('value', context => context.render(parameter(input)))
  return Object.freeze({ ...expression, value: input })
}

/** Bind a value while declaring its SQL semantic domain. */
export function typedValue<TSqlType extends AnySqlType, T>(
  input: T
): ValueExpression<T, TSqlType> {
  return value(input) as unknown as ValueExpression<T, TSqlType>
}

export function isExpressionValue(
  valueToCheck: unknown
): valueToCheck is AnyExpression {
  return (
    typeof valueToCheck === 'object' &&
    valueToCheck !== null &&
    'expressionKind' in valueToCheck &&
    'render' in valueToCheck &&
    typeof valueToCheck.render === 'function'
  )
}

export function isValueExpression(
  valueToCheck: unknown
): valueToCheck is ValueExpression {
  return (
    isExpressionValue(valueToCheck) &&
    valueToCheck.expressionKind === 'value' &&
    'value' in valueToCheck
  )
}

export function asValue<TInput>(
  input: TInput
): TInput extends AnyExpression ? TInput : ValueExpression<TInput>
export function asValue(input: unknown): AnyExpression {
  return isExpressionValue(input) ? input : value(input)
}
