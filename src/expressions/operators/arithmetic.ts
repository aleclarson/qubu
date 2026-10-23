import type { NullabilityOf } from "../../core/fragment.ts"
import type { SqlNumericLike } from "../../core/sql-types.ts"
import { resultValue, resultValueOf } from "../../result.ts"
import {
  makeSchemaExpression,
  type AnyExpression,
  type ExpressionOutput,
  type ResultExpression,
} from "../types.ts"
import type { ExpressionSqlType } from "../types.ts"
import { expressionOperand, type Operand, type OperandDomain } from "./shared.ts"
import type { OperandSqlType, SqlCapabilityValidation, SqlOrderValidation } from "./shared.ts"

function arithmetic<TLeft extends AnyExpression, R extends Operand<OperandDomain<ExpressionOutput<TLeft>>>>(
  operator: string,
  left: TLeft,
  right: R,
) {
  const rightExpression = expressionOperand(right)
  const leftMeta = resultValueOf(left)

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
      leftMeta?.type,
      leftMeta?.decoder,
      leftMeta?.sqlType === "integer" ? "decimal" : leftMeta?.sqlType,
    ),
  ) as ResultExpression<{
    readonly output: ExpressionOutput<TLeft>
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

export const add = <
  TLeft extends AnyExpression,
  R extends Operand<OperandDomain<ExpressionOutput<TLeft>>>,
>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R,
) => arithmetic("+", left, right)

export const subtract = <
  TLeft extends AnyExpression,
  R extends Operand<OperandDomain<ExpressionOutput<TLeft>>>,
>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R,
) => arithmetic("-", left, right)

export const multiply = <
  TLeft extends AnyExpression,
  R extends Operand<OperandDomain<ExpressionOutput<TLeft>>>,
>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R,
) => arithmetic("*", left, right)

export const divide = <
  TLeft extends AnyExpression,
  R extends Operand<OperandDomain<ExpressionOutput<TLeft>>>,
>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R,
) => arithmetic("/", left, right)

export const modulo = <
  TLeft extends AnyExpression,
  R extends Operand<OperandDomain<ExpressionOutput<TLeft>>>,
>(
  left: TLeft & ArithmeticValidation<TLeft, R>,
  right: R,
) => arithmetic("%", left, right)
