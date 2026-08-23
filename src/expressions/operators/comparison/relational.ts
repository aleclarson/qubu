import {
  makeSchemaExpression,
  type AnyExpression,
  type ExpressionWithOutput,
  type ExpressionOutput,
  type ResultExpression,
} from '../../types.ts'
import type { NullabilityOf } from '../../../core/fragment.ts'
import type { SqlBoolean, SqlTextLike } from '../../../core/sql-types.ts'
import {
  expressionOperand,
  isNullOperand,
  type IsNullOperand,
  type Operand,
  type OperandNullability,
  type OperandSqlType,
  type SqlCapabilityValidation,
  type SqlEqualityValidation,
  type SqlOrderValidation,
} from '../shared.ts'
import type { ExpressionSqlType } from '../../types.ts'
import { queryValidationError } from '../../../query/errors.ts'

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
      : NullabilityOf<TLeft> | OperandNullability<R>,
  SqlBoolean
>

/** SQL-domain validation selected by a comparison operator family. */
export type ComparisonValidation<
  TLeft,
  TRight,
  TOperator extends string,
> = TOperator extends 'LIKE' | 'NOT LIKE' | 'ILIKE'
  ? SqlCapabilityValidation<ExpressionSqlType<TLeft>, SqlTextLike> &
      SqlCapabilityValidation<
        OperandSqlType<TRight, ExpressionSqlType<TLeft>>,
        SqlTextLike
      >
  : TOperator extends '<' | '<=' | '>' | '>='
    ? SqlOrderValidation<
        ExpressionSqlType<TLeft>,
        OperandSqlType<TRight, ExpressionSqlType<TLeft>>
      >
    : SqlEqualityValidation<
        ExpressionSqlType<TLeft>,
        OperandSqlType<TRight, ExpressionSqlType<TLeft>>
      >

export function comparison<
  T,
  TLeft extends ExpressionWithOutput<T>,
  const TOperator extends string,
  R extends Operand<NoInfer<T>>,
>(
  operator: TOperator,
  left: TLeft & ComparisonValidation<TLeft, R, TOperator>,
  right: R
): ComparisonResult<TLeft, R, TOperator> {
  if (isNullOperand(right)) {
    if (operator === '=' || operator === '<>') {
      const nullOperator = operator === '=' ? 'IS NULL' : 'IS NOT NULL'
      return makeSchemaExpression('operator', context => {
        context.append('(')
        context.render(left)
        context.append(` ${nullOperator})`)
      }) as ComparisonResult<TLeft, R, TOperator>
    }
    if (
      operator !== 'IS DISTINCT FROM' &&
      operator !== 'IS NOT DISTINCT FROM'
    ) {
      throw queryValidationError({
        code: 'invalid-comparison',
        context: 'expression.comparison.null',
        path: ['comparison', operator],
        message: `Cannot compare NULL with ${operator}; use isNull(), isNotNull(), or a distinctness predicate`,
        hint: 'Use isNull(), isNotNull(), or a distinctness predicate for NULL comparisons.',
      })
    }
  }

  const rightExpression = expressionOperand(right)
  return makeSchemaExpression('operator', context => {
    context.append('(')
    context.render(left)
    context.append(` ${operator} `)
    context.render(rightExpression)
    context.append(')')
  }) as ComparisonResult<TLeft, R, TOperator>
}

export function eq<
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(left: TLeft & ComparisonValidation<TLeft, R, '='>, right: R) {
  return comparison('=', left, right)
}

export function ne<
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(left: TLeft & ComparisonValidation<TLeft, R, '<>'>, right: R) {
  return comparison('<>', left, right)
}

export function lt<
  TLeft extends AnyExpression,
  R extends Operand<Exclude<ExpressionOutput<TLeft>, null>>,
>(left: TLeft & ComparisonValidation<TLeft, R, '<'>, right: R) {
  return comparison('<', left, right)
}

export function lte<
  TLeft extends AnyExpression,
  R extends Operand<Exclude<ExpressionOutput<TLeft>, null>>,
>(left: TLeft & ComparisonValidation<TLeft, R, '<='>, right: R) {
  return comparison('<=', left, right)
}

export function gt<
  TLeft extends AnyExpression,
  R extends Operand<Exclude<ExpressionOutput<TLeft>, null>>,
>(left: TLeft & ComparisonValidation<TLeft, R, '>'>, right: R) {
  return comparison('>', left, right)
}

export function gte<
  TLeft extends AnyExpression,
  R extends Operand<Exclude<ExpressionOutput<TLeft>, null>>,
>(left: TLeft & ComparisonValidation<TLeft, R, '>='>, right: R) {
  return comparison('>=', left, right)
}

export function like<
  TLeft extends ExpressionWithOutput<string>,
  R extends Operand<string>,
>(left: TLeft & ComparisonValidation<TLeft, R, 'LIKE'>, pattern: R) {
  return comparison('LIKE', left, pattern)
}

export function notLike<
  TLeft extends ExpressionWithOutput<string>,
  R extends Operand<string>,
>(left: TLeft & ComparisonValidation<TLeft, R, 'NOT LIKE'>, pattern: R) {
  return comparison('NOT LIKE', left, pattern)
}

export function isDistinctFrom<
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(left: TLeft & ComparisonValidation<TLeft, R, 'IS DISTINCT FROM'>, right: R) {
  return comparison('IS DISTINCT FROM', left, right)
}

export function isNotDistinctFrom<
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(
  left: TLeft & ComparisonValidation<TLeft, R, 'IS NOT DISTINCT FROM'>,
  right: R
) {
  return comparison('IS NOT DISTINCT FROM', left, right)
}
