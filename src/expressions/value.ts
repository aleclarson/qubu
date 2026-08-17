import { parameter } from '../core/primitives/parameter.ts'
import { makeExpression, type AnyExpression, type Expression } from './types.ts'

export function value<T>(input: T): Expression<T, never, T, 'value'> {
  return makeExpression<T, never, T, 'value'>('value', context => {
    context.render(parameter(input))
  })
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

export function asValue<T>(
  input: T | Expression<T, any, any>
): Expression<T, any, any> {
  return isExpressionValue(input) ? input : value(input)
}
