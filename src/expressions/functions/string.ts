import { call } from './call.ts'
import type { Operand } from '../operators/shared.ts'
import type { ExpressionWithOutput } from '../types.ts'

export function lower<TExpression extends ExpressionWithOutput<string>>(
  expression: TExpression
) {
  return call<string, 'LOWER', [TExpression]>('LOWER', expression)
}

export function upper<TExpression extends ExpressionWithOutput<string>>(
  expression: TExpression
) {
  return call<string, 'UPPER', [TExpression]>('UPPER', expression)
}

export function coalesce<
  T,
  const TExpressions extends readonly ExpressionWithOutput<T>[],
>(...expressions: TExpressions) {
  return call<T, 'COALESCE', TExpressions, never>('COALESCE', ...expressions)
}

export function concat<const TArguments extends readonly Operand<string>[]>(
  ...argumentsToConcat: TArguments
) {
  return call<string, 'CONCAT', TArguments>('CONCAT', ...argumentsToConcat)
}
