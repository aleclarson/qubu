import type { SqlText, SqlTextLike } from "../../core/sql-types.ts"
import { attachResultValue, resultValue, resultValueOf } from "../../result.ts"
import type {
  Operand,
  OperandDomain,
  OperandNullOutput,
  OperandOutput,
} from "../operators/shared.ts"
import type {
  OperandSqlType,
  SqlCapabilityValidation,
  SqlEqualityValidation,
} from "../operators/shared.ts"
import type { AnyExpression, ExpressionOutput } from "../types.ts"
import type { ExpressionSqlType } from "../types.ts"
import { schemaCall } from "./call.ts"

type TextOperandValidation<TInput> = SqlCapabilityValidation<
  OperandSqlType<TInput, SqlText>,
  SqlTextLike
>

type TextArgumentsValidation<TArguments extends readonly unknown[]> = TArguments extends readonly [
  infer THead,
  ...infer TTail,
]
  ? SqlCapabilityValidation<OperandSqlType<THead, SqlText>, SqlTextLike> &
      TextArgumentsValidation<TTail>
  : unknown

type CoalesceValidation<TFirst, TRest extends readonly unknown[]> = TRest extends readonly [
  infer THead,
  ...infer TTail,
]
  ? SqlEqualityValidation<
      ExpressionSqlType<TFirst>,
      OperandSqlType<THead, ExpressionSqlType<TFirst>>
    > &
      CoalesceValidation<TFirst, TTail>
  : unknown

export function lower<const TInput extends Operand<string | null>>(
  input: TInput & TextOperandValidation<TInput>,
) {
  return attachResultValue(
    schemaCall<
      string | OperandNullOutput<TInput>,
      "LOWER",
      [TInput],
      import("../../core/fragment.ts").NullabilityOf<TInput>,
      SqlText
    >("LOWER", input),
    resultValue(undefined, undefined, "text"),
  )
}

export function upper<const TInput extends Operand<string | null>>(
  input: TInput & TextOperandValidation<TInput>,
) {
  return attachResultValue(
    schemaCall<
      string | OperandNullOutput<TInput>,
      "UPPER",
      [TInput],
      import("../../core/fragment.ts").NullabilityOf<TInput>,
      SqlText
    >("UPPER", input),
    resultValue(undefined, undefined, "text"),
  )
}

export function coalesce<
  TFirst extends AnyExpression,
  const TRest extends readonly Operand<NoInfer<OperandDomain<ExpressionOutput<TFirst>>>>[],
>(
  first: TFirst,
  ...rest: TRest & CoalesceValidation<TFirst, TRest>
) {
  return attachResultValue(
    schemaCall<
      Exclude<ExpressionOutput<TFirst>, null> | OperandOutput<TRest[number]>,
      "COALESCE",
      [TFirst, ...TRest],
      never,
      ExpressionSqlType<TFirst>
    >("COALESCE", first, ...(rest as unknown as TRest)),
    resultValueOf(first),
  )
}

export function concat<const TArguments extends readonly Operand<string | null>[]>(
  ...argumentsToConcat: TArguments & TextArgumentsValidation<TArguments>
) {
  return attachResultValue(
    schemaCall<
      string | OperandNullOutput<TArguments[number]>,
      "CONCAT",
      TArguments,
      import("../../core/fragment.ts").NullabilityOf<TArguments[number]>,
      SqlText
    >("CONCAT", ...(argumentsToConcat as TArguments)),
    resultValue(undefined, undefined, "text"),
  )
}
