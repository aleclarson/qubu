import {
  makeExpression,
  type AnyExpression,
  type ExpressionWithOutput,
  type ExpressionOutput,
  type ResultExpression,
} from '../../types.ts'
import type { NullabilityOf } from '../../../core/fragment.ts'
import {
  expressionOperand,
  isNullOperand,
  type IsNullOperand,
  type Operand,
  type OperandNullability,
} from '../shared.ts'

type ComparisonResult<TLeft, R, TOperator extends string> = ResultExpression<
  boolean,
  TLeft | R,
  'operator',
  TOperator extends 'IS DISTINCT FROM' | 'IS NOT DISTINCT FROM'
    ? never
    : TOperator extends '=' | '<>'
      ? IsNullOperand<R> extends true
        ? never
        : NullabilityOf<TLeft> | OperandNullability<R>
      : NullabilityOf<TLeft> | OperandNullability<R>
>

export function comparison<
  T,
  TLeft extends ExpressionWithOutput<T>,
  const TOperator extends string,
  R extends Operand<NoInfer<T>>,
>(
  operator: TOperator,
  left: TLeft,
  right: R
): ComparisonResult<TLeft, R, TOperator> {
  if (isNullOperand(right)) {
    if (operator === '=' || operator === '<>') {
      const nullOperator = operator === '=' ? 'IS NULL' : 'IS NOT NULL'
      return makeExpression('operator', context => {
        context.append('(')
        context.render(left)
        context.append(` ${nullOperator})`)
      }) as ComparisonResult<TLeft, R, TOperator>
    }
    if (
      operator !== 'IS DISTINCT FROM' &&
      operator !== 'IS NOT DISTINCT FROM'
    ) {
      throw new TypeError(
        `Cannot compare NULL with ${operator}; use isNull(), isNotNull(), or a distinctness predicate`
      )
    }
  }

  const rightExpression = expressionOperand(right)
  return makeExpression('operator', context => {
    context.append('(')
    context.render(left)
    context.append(` ${operator} `)
    context.render(rightExpression)
    context.append(')')
  }) as ComparisonResult<TLeft, R, TOperator>
}

export function equal<
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(left: TLeft, right: R) {
  return comparison('=', left, right)
}

export const eq = equal

export function notEqual<
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(left: TLeft, right: R) {
  return comparison('<>', left, right)
}

export const ne = notEqual

export function lessThan<
  TLeft extends AnyExpression,
  R extends Operand<Exclude<ExpressionOutput<TLeft>, null>>,
>(left: TLeft, right: R) {
  return comparison('<', left, right)
}

export const lt = lessThan

export function lessThanOrEqual<
  TLeft extends AnyExpression,
  R extends Operand<Exclude<ExpressionOutput<TLeft>, null>>,
>(left: TLeft, right: R) {
  return comparison('<=', left, right)
}

export const lte = lessThanOrEqual

export function greaterThan<
  TLeft extends AnyExpression,
  R extends Operand<Exclude<ExpressionOutput<TLeft>, null>>,
>(left: TLeft, right: R) {
  return comparison('>', left, right)
}

export const gt = greaterThan

export function greaterThanOrEqual<
  TLeft extends AnyExpression,
  R extends Operand<Exclude<ExpressionOutput<TLeft>, null>>,
>(left: TLeft, right: R) {
  return comparison('>=', left, right)
}

export const gte = greaterThanOrEqual

export function like<
  TLeft extends ExpressionWithOutput<string>,
  R extends Operand<string>,
>(left: TLeft, pattern: R) {
  return comparison('LIKE', left, pattern)
}

export function notLike<
  TLeft extends ExpressionWithOutput<string>,
  R extends Operand<string>,
>(left: TLeft, pattern: R) {
  return comparison('NOT LIKE', left, pattern)
}

export function isDistinctFrom<
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(left: TLeft, right: R) {
  return comparison('IS DISTINCT FROM', left, right)
}

export function isNotDistinctFrom<
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(left: TLeft, right: R) {
  return comparison('IS NOT DISTINCT FROM', left, right)
}
