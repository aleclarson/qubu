import {
  makeSchemaExpression,
  type ExpressionWithOutput,
  type ResultExpression,
} from '../../types.ts'
import { expressionOperand, isNullOperand, type Operand } from '../shared.ts'
import type { ExpressionSqlType } from '../../types.ts'
import type { SqlBoolean } from '../../../core/sql-types.ts'
import type { NullabilityOf } from '../../../core/fragment.ts'
import type {
  OperandSqlType,
  SqlEqualityValidation,
  SqlOrderValidation,
} from '../shared.ts'

type BetweenValidation<TExpression, TLower, TUpper> = SqlOrderValidation<
  ExpressionSqlType<TExpression>,
  OperandSqlType<TLower, ExpressionSqlType<TExpression>>
> &
  SqlOrderValidation<
    ExpressionSqlType<TExpression>,
    OperandSqlType<TUpper, ExpressionSqlType<TExpression>>
  >

type ListValidation<
  TExpression,
  TValues extends readonly unknown[],
> = TValues extends readonly [infer THead, ...infer TTail]
  ? SqlEqualityValidation<
      ExpressionSqlType<TExpression>,
      OperandSqlType<THead, ExpressionSqlType<TExpression>>
    > &
      ListValidation<TExpression, TTail>
  : unknown

export function between<
  T,
  TExpression extends ExpressionWithOutput<T>,
  L extends Operand<NoInfer<T>>,
  H extends Operand<NoInfer<T>>,
>(
  expression: TExpression & BetweenValidation<TExpression, L, H>,
  lower: L,
  upper: H
) {
  if (isNullOperand(lower) || isNullOperand(upper)) {
    throw new TypeError(
      'between() does not accept NULL bounds; use an explicit NULL predicate'
    )
  }
  const lowerExpression = expressionOperand(lower)
  const upperExpression = expressionOperand(upper)
  return makeSchemaExpression('operator', context => {
    context.append('(')
    context.render(expression)
    context.append(' BETWEEN ')
    context.render(lowerExpression)
    context.append(' AND ')
    context.render(upperExpression)
    context.append(')')
  }) as ResultExpression<
    boolean,
    TExpression | L | H,
    'operator',
    NullabilityOf<TExpression | L | H>,
    SqlBoolean
  >
}

export function inList<
  T,
  TExpression extends ExpressionWithOutput<T>,
  const TValues extends readonly Operand<NoInfer<T>>[],
>(
  expression: TExpression & ListValidation<TExpression, TValues>,
  values: TValues
) {
  const valueExpressions = values.map(expressionOperand)
  return makeSchemaExpression('operator', context => {
    if (values.length === 0) {
      context.append('(1 = 0)')
      return
    }
    context.append('(')
    context.render(expression)
    context.append(' IN (')
    valueExpressions.forEach((value, index) => {
      if (index > 0) context.append(', ')
      context.render(value)
    })
    context.append('))')
  }) as ResultExpression<
    boolean,
    TExpression | TValues[number],
    'operator',
    NullabilityOf<TExpression | TValues[number]>,
    SqlBoolean
  >
}

export function notIn<
  T,
  TExpression extends ExpressionWithOutput<T>,
  const TValues extends readonly Operand<NoInfer<T>>[],
>(
  expression: TExpression & ListValidation<TExpression, TValues>,
  values: TValues
) {
  const valueExpressions = values.map(expressionOperand)
  return makeSchemaExpression('operator', context => {
    if (values.length === 0) {
      context.append('(1 = 1)')
      return
    }
    context.append('(')
    context.render(expression)
    context.append(' NOT IN (')
    valueExpressions.forEach((value, index) => {
      if (index > 0) context.append(', ')
      context.render(value)
    })
    context.append('))')
  }) as ResultExpression<
    boolean,
    TExpression | TValues[number],
    'operator',
    NullabilityOf<TExpression | TValues[number]>,
    SqlBoolean
  >
}
