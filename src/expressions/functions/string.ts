import type { SqlText, SqlTextLike } from "../../core/sql-types.ts"
import type { Operand } from "../operators/shared.ts"
import type {
  OperandSqlType,
  SqlCapabilityValidation,
  SqlEqualityValidation,
} from "../operators/shared.ts"
import type { ExpressionWithOutput } from "../types.ts"
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

export function lower<const TInput extends Operand<string>>(
  input: TInput & TextOperandValidation<TInput>,
) {
  return schemaCall<
    string,
    "LOWER",
    [TInput],
    import("../../core/fragment.ts").NullabilityOf<TInput>,
    SqlText
  >("LOWER", input)
}

export function upper<const TInput extends Operand<string>>(
  input: TInput & TextOperandValidation<TInput>,
) {
  return schemaCall<
    string,
    "UPPER",
    [TInput],
    import("../../core/fragment.ts").NullabilityOf<TInput>,
    SqlText
  >("UPPER", input)
}

export function coalesce<
  T,
  TFirst extends ExpressionWithOutput<T>,
  const TRest extends readonly Operand<NoInfer<T>>[],
>(first: TFirst, ...rest: TRest & CoalesceValidation<TFirst, TRest>) {
  return schemaCall<T, "COALESCE", [TFirst, ...TRest], never, ExpressionSqlType<TFirst>>(
    "COALESCE",
    first,
    ...(rest as unknown as TRest),
  )
}

export function concat<const TArguments extends readonly Operand<string>[]>(
  ...argumentsToConcat: TArguments & TextArgumentsValidation<TArguments>
) {
  return schemaCall<
    string,
    "CONCAT",
    TArguments,
    import("../../core/fragment.ts").NullabilityOf<TArguments[number]>,
    SqlText
  >("CONCAT", ...(argumentsToConcat as TArguments))
}
