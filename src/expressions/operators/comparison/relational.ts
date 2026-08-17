import { makeExpression, type Expression } from '../../types.ts'
import {
  expressionOperand,
  type Operand,
  type OperandParameters,
  type OperandRequires,
} from '../shared.ts'
import type { BooleanExpression } from './types.ts'

type ComparisonResult<LReq, LParams, R> = BooleanExpression<
  LReq | OperandRequires<R>,
  LParams | OperandParameters<R>
>

export function comparison<T, LRequires, LParameters, R extends Operand<T>>(
  operator: string,
  left: Expression<T, LRequires, LParameters, any>,
  right: R
): ComparisonResult<LRequires, LParameters, R> {
  const rightExpression = expressionOperand(right)
  return makeExpression('operator', context => {
    context.append('(')
    context.render(left)
    context.append(` ${operator} `)
    context.render(rightExpression)
    context.append(')')
  }) as ComparisonResult<LRequires, LParameters, R>
}

export function equal<T, LReq, LParams, R extends Operand<T>>(
  left: Expression<T, LReq, LParams, any>,
  right: R
) {
  return comparison('=', left, right)
}

export const eq = equal

export function notEqual<T, LReq, LParams, R extends Operand<T>>(
  left: Expression<T, LReq, LParams, any>,
  right: R
) {
  return comparison('<>', left, right)
}

export const ne = notEqual

export function lessThan<T, LReq, LParams, R extends Operand<T>>(
  left: Expression<T, LReq, LParams, any>,
  right: R
) {
  return comparison('<', left, right)
}

export const lt = lessThan

export function lessThanOrEqual<T, LReq, LParams, R extends Operand<T>>(
  left: Expression<T, LReq, LParams, any>,
  right: R
) {
  return comparison('<=', left, right)
}

export const lte = lessThanOrEqual

export function greaterThan<T, LReq, LParams, R extends Operand<T>>(
  left: Expression<T, LReq, LParams, any>,
  right: R
) {
  return comparison('>', left, right)
}

export const gt = greaterThan

export function greaterThanOrEqual<T, LReq, LParams, R extends Operand<T>>(
  left: Expression<T, LReq, LParams, any>,
  right: R
) {
  return comparison('>=', left, right)
}

export const gte = greaterThanOrEqual

export function like<TReq, TParams, R extends Operand<string>>(
  left: Expression<string, TReq, TParams, any>,
  pattern: R
) {
  return comparison('LIKE', left, pattern)
}

export function notLike<TReq, TParams, R extends Operand<string>>(
  left: Expression<string, TReq, TParams, any>,
  pattern: R
) {
  return comparison('NOT LIKE', left, pattern)
}

export function isDistinctFrom<T, LReq, LParams, R extends Operand<T>>(
  left: Expression<T, LReq, LParams, any>,
  right: R
) {
  return comparison('IS DISTINCT FROM', left, right)
}

export function isNotDistinctFrom<T, LReq, LParams, R extends Operand<T>>(
  left: Expression<T, LReq, LParams, any>,
  right: R
) {
  return comparison('IS NOT DISTINCT FROM', left, right)
}
