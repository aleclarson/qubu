import { makeExpression, type Expression } from '../types.ts'
import {
  expressionOperand,
  type Operand,
  type OperandParameters,
  type OperandRequires,
} from './shared.ts'

function arithmetic<T, LRequires, LParameters, R extends Operand<T>>(
  operator: string,
  left: Expression<T, LRequires, LParameters, any>,
  right: R
) {
  const rightExpression = expressionOperand(right)
  return makeExpression('operator', context => {
    context.append('(')
    context.render(left)
    context.append(` ${operator} `)
    context.render(rightExpression)
    context.append(')')
  }) as Expression<
    T,
    LRequires | OperandRequires<R>,
    LParameters | OperandParameters<R>,
    'operator'
  >
}

export const add = <T, LReq, LParams, R extends Operand<T>>(
  left: Expression<T, LReq, LParams, any>,
  right: R
) => arithmetic('+', left, right)

export const subtract = <T, LReq, LParams, R extends Operand<T>>(
  left: Expression<T, LReq, LParams, any>,
  right: R
) => arithmetic('-', left, right)

export const multiply = <T, LReq, LParams, R extends Operand<T>>(
  left: Expression<T, LReq, LParams, any>,
  right: R
) => arithmetic('*', left, right)

export const divide = <T, LReq, LParams, R extends Operand<T>>(
  left: Expression<T, LReq, LParams, any>,
  right: R
) => arithmetic('/', left, right)

export const modulo = <T, LReq, LParams, R extends Operand<T>>(
  left: Expression<T, LReq, LParams, any>,
  right: R
) => arithmetic('%', left, right)
