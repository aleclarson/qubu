import type { Fragment, SqlTypeOf } from "../core/fragment.ts"
import type { SqlUnknown } from "../core/sql-types.ts"
import type { SqlBoolean } from "../core/sql-types.ts"
import { resultValue, resultValueOf } from "../result.ts"
import type { BooleanExpression } from "./operators/comparison.ts"
import { type Operand, type OperandNullability } from "./operators/shared.ts"
import type { OperandSqlType, SqlEqualityValidation } from "./operators/shared.ts"
import type { SqlCapabilityValidation } from "./operators/shared.ts"
import { makeSchemaExpression, type ResultExpression } from "./types.ts"
import type { ExpressionSqlType } from "./types.ts"
import { asValue } from "./value.ts"

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
  condition: TCondition & SqlCapabilityValidation<ExpressionSqlType<TCondition>, SqlBoolean>,
  thenValue: TThen &
    SqlEqualityValidation<
      OperandSqlType<TThen, CaseSqlType<TThen, TElse>>,
      OperandSqlType<TElse, CaseSqlType<TThen, TElse>>
    >,
  elseValue: TElse,
) {
  const thenExpression = asValue(thenValue)
  const elseExpression = asValue(elseValue)

  const domain = resultValueOf(thenExpression)?.sqlType ?? resultValueOf(elseExpression)?.sqlType

  return makeSchemaExpression(
    "operator",
    (context) => {
      context.append("CASE WHEN ")
      context.render(condition)
      context.append(" THEN ")
      context.render(thenExpression)
      context.append(" ELSE ")
      context.render(elseExpression)
      context.append(" END")
    },
    resultValue(undefined, undefined, domain === "integer" ? "decimal" : domain),
  ) as ResultExpression<{
    readonly output: T
    readonly children: TCondition | TThen | TElse
    readonly kind: "operator"
    readonly nullableFrom: OperandNullability<TThen> | OperandNullability<TElse>
    readonly sqlType: CaseSqlType<TThen, TElse>
  }>
}
