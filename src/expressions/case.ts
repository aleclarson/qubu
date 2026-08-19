import { asValue } from './value.ts'
import type { BooleanExpression } from './operators/comparison.ts'
import { type Operand, type OperandNullability } from './operators/shared.ts'
import { makeExpression, type ResultExpression } from './types.ts'
import type {
  OperandSqlType,
  SqlEqualityValidation,
} from './operators/shared.ts'
import type { Fragment, SqlTypeOf } from '../core/fragment.ts'
import type { SqlUnknown } from '../core/sql-types.ts'
import type { SqlBoolean } from '../core/sql-types.ts'
import type { ExpressionSqlType } from './types.ts'
import type { SqlCapabilityValidation } from './operators/shared.ts'

type CaseSqlType<TThen, TElse> =
  TThen extends Fragment<any>
    ? SqlTypeOf<TThen>
    : TElse extends Fragment<any>
      ? SqlTypeOf<TElse>
      : SqlUnknown

export function caseWhen<
  T,
  TCondition extends BooleanExpression<any>,
  TThen extends Operand<T>,
  TElse extends Operand<T>,
>(
  condition: TCondition &
    SqlCapabilityValidation<ExpressionSqlType<TCondition>, SqlBoolean>,
  thenValue: TThen &
    SqlEqualityValidation<
      OperandSqlType<TThen, CaseSqlType<TThen, TElse>>,
      OperandSqlType<TElse, CaseSqlType<TThen, TElse>>
    >,
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
  }) as ResultExpression<
    T,
    TCondition | TThen | TElse,
    'operator',
    OperandNullability<TThen> | OperandNullability<TElse>,
    CaseSqlType<TThen, TElse>
  >
}
