import { parameter } from '../core/primitives/parameter.ts'
import { makeExpression, type AnyExpression, type Expression } from './types.ts'

export interface ValueExpression<T = unknown>
  extends Expression<T, never, T, 'value'> {
  readonly value: T
}

export function value<T>(input: T): ValueExpression<T> {
  const expression = makeExpression<T, never, T, 'value'>('value', context => {
    context.render(parameter(input))
  })
  return Object.freeze({ ...expression, value: input })
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

export function asValue<T>(
  input: T | Expression<T, any, any>
): Expression<T, any, any> {
  return isExpressionValue(input) ? input : value(input)
}
