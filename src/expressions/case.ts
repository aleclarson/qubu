import { asValue } from './value.ts'
import type { BooleanExpression } from './operators/comparison.ts'
import {
  type OperandParameters,
  type OperandRequires,
  type Operand,
} from './operators/shared.ts'
import { makeExpression, type Expression } from './types.ts'

export function caseWhen<
  T,
  TWhenRequires,
  TWhenParameters,
  TThen extends Operand<T>,
  TElse extends Operand<T>,
>(
  condition: BooleanExpression<TWhenRequires, TWhenParameters>,
  thenValue: TThen,
  elseValue: TElse
) {
  const thenExpression = asValue(thenValue)
  const elseExpression = asValue(elseValue)
  return makeExpression('operator', context => {
    context.append('CASE WHEN ')
    context.render(condition)
    context.append(' THEN ')
    context.render(thenExpression)
    context.append(' ELSE ')
    context.render(elseExpression)
    context.append(' END')
  }) as Expression<
    T,
    TWhenRequires | OperandRequires<TThen> | OperandRequires<TElse>,
    TWhenParameters | OperandParameters<TThen> | OperandParameters<TElse>,
    'operator'
  >
}
