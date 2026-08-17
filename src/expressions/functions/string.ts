import { call } from './call.ts'
import type { Operand } from '../operators/shared.ts'
import type { Expression } from '../types.ts'

export function lower<TReq, TParams>(
  expression: Expression<string, TReq, TParams, any>
) {
  return call<string, 'LOWER', [Expression<string, TReq, TParams, any>]>(
    'LOWER',
    expression
  )
}

export function upper<TReq, TParams>(
  expression: Expression<string, TReq, TParams, any>
) {
  return call<string, 'UPPER', [Expression<string, TReq, TParams, any>]>(
    'UPPER',
    expression
  )
}

export function coalesce<
  T,
  const TExpressions extends readonly Expression<T, any, any, any>[],
>(...expressions: TExpressions) {
  return call<T, 'COALESCE', TExpressions>('COALESCE', ...expressions)
}

export function concat<const TArguments extends readonly Operand<string>[]>(
  ...argumentsToConcat: TArguments
) {
  return call<string, 'CONCAT', TArguments>('CONCAT', ...argumentsToConcat)
}
