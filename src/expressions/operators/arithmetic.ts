import {
  makeExpression,
  type ExpressionWithOutput,
  type ResultExpression,
} from '../types.ts'
import { expressionOperand, type Operand } from './shared.ts'
import type { ExpressionSqlType } from '../types.ts'
import type { SqlNumericLike } from '../../core/sql-types.ts'
import type { NullabilityOf } from '../../core/fragment.ts'
import type {
  OperandSqlType,
  SqlCapabilityValidation,
  SqlOrderValidation,
} from './shared.ts'

function arithmetic<
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(operator: string, left: TLeft, right: R) {
  const rightExpression = expressionOperand(right)
  return makeExpression('operator', context => {
    context.append('(')
    context.render(left)
    context.append(` ${operator} `)
    context.render(rightExpression)
    context.append(')')
  }) as ResultExpression<
    T,
    TLeft | R,
    'operator',
    NullabilityOf<TLeft | R>,
    ExpressionSqlType<TLeft>
  >
}

type ArithmeticValidation<TLeft, TRight> = SqlCapabilityValidation<
  ExpressionSqlType<TLeft>,
  SqlNumericLike
> &
  SqlCapabilityValidation<
    OperandSqlType<TRight, ExpressionSqlType<TLeft>>,
    SqlNumericLike
  > &
  SqlOrderValidation<
    ExpressionSqlType<TLeft>,
    OperandSqlType<TRight, ExpressionSqlType<TLeft>>
  >

export const add = <
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R
) => arithmetic('+', left, right)

export const subtract = <
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R
) => arithmetic('-', left, right)

export const multiply = <
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R
) => arithmetic('*', left, right)

export const divide = <
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R
) => arithmetic('/', left, right)

export const modulo = <
  T,
  TLeft extends ExpressionWithOutput<T>,
  R extends Operand<NoInfer<T>>,
>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R
) => arithmetic('%', left, right)
