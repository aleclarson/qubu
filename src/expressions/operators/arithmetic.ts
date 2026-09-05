import type { NullabilityOf } from "../../core/fragment.ts"
import type { SqlNumericLike } from "../../core/sql-types.ts"
import { resultValue, resultValueOf } from "../../result.ts"
import { makeSchemaExpression, type ExpressionWithOutput, type ResultExpression } from "../types.ts"
import type { ExpressionSqlType } from "../types.ts"
import { expressionOperand, type Operand } from "./shared.ts"
import type { OperandSqlType, SqlCapabilityValidation, SqlOrderValidation } from "./shared.ts"

function arithmetic<T, TLeft extends ExpressionWithOutput<T>, R extends Operand<NoInfer<T>>>(
  operator: string,
  left: TLeft,
  right: R,
) {
  const rightExpression = expressionOperand(right)

  return makeSchemaExpression(
    "operator",
    (context) => {
      context.append("(")
      context.render(left)
      context.append(` ${operator} `)
      context.render(rightExpression)
      context.append(")")
    },
    resultValue(
      undefined,
      undefined,
      resultValueOf(left)?.sqlType === "integer" ? "decimal" : resultValueOf(left)?.sqlType,
    ),
  ) as ResultExpression<{
    readonly output: T
    readonly children: TLeft | R
    readonly kind: "operator"
    readonly nullableFrom: NullabilityOf<TLeft | R>
    readonly sqlType: ExpressionSqlType<TLeft>
  }>
}

type ArithmeticValidation<TLeft, TRight> = SqlCapabilityValidation<
  ExpressionSqlType<TLeft>,
  SqlNumericLike
> &
  SqlCapabilityValidation<OperandSqlType<TRight, ExpressionSqlType<TLeft>>, SqlNumericLike> &
  SqlOrderValidation<ExpressionSqlType<TLeft>, OperandSqlType<TRight, ExpressionSqlType<TLeft>>>

export const add = <T, TLeft extends ExpressionWithOutput<T>, R extends Operand<NoInfer<T>>>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R,
) => arithmetic("+", left, right)

export const subtract = <T, TLeft extends ExpressionWithOutput<T>, R extends Operand<NoInfer<T>>>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R,
) => arithmetic("-", left, right)

export const multiply = <T, TLeft extends ExpressionWithOutput<T>, R extends Operand<NoInfer<T>>>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R,
) => arithmetic("*", left, right)

export const divide = <T, TLeft extends ExpressionWithOutput<T>, R extends Operand<NoInfer<T>>>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R,
) => arithmetic("/", left, right)

export const modulo = <T, TLeft extends ExpressionWithOutput<T>, R extends Operand<NoInfer<T>>>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R,
) => arithmetic("%", left, right)
