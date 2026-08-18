import { asValue } from './value.ts'
import type { BooleanExpression } from './operators/comparison.ts'
import { type Operand, type OperandNullability } from './operators/shared.ts'
import { makeExpression, type ResultExpression } from './types.ts'

export function caseWhen<
  T,
  TCondition extends BooleanExpression<any>,
  TThen extends Operand<T>,
  TElse extends Operand<T>,
>(condition: TCondition, thenValue: TThen, elseValue: TElse) {
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
  }) as ResultExpression<
    T,
    TCondition | TThen | TElse,
    'operator',
    OperandNullability<TThen> | OperandNullability<TElse>
  >
}
