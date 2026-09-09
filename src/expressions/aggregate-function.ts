import { routineName } from "../core/primitives/routine.ts"
import { call } from "./functions/call.ts"
import { markExpressionCategory, type AggregateResultExpression } from "./types.ts"

/**
 * Declare a reusable SQL aggregate while inferring dependencies from each call's arguments.
 *
 * The result uses `SqlUnknown` and inherits argument nullability, like `call()`. `TOutput` declares
 * the result type without attaching a decoder. Function availability, argument restrictions, and
 * result policies belong to the downstream declaration.
 *
 * @example
 *   const jsonGroupArray = aggregateFunction<string>("json_group_array")
 *   const categories = jsonGroupArray(gameCategory.name)
 *
 * @throws If the name is not a valid SQL routine name.
 */
export function aggregateFunction<TOutput = unknown>(name: string) {
  routineName(name)

  return <const TArguments extends readonly unknown[]>(
    ...args: TArguments
  ): AggregateResultExpression<{
    readonly output: TOutput
    readonly children: TArguments[number]
    readonly kind: "function"
  }> =>
    markExpressionCategory(
      call<TOutput, string, TArguments>(name, ...args),
      "aggregate",
    ) as AggregateResultExpression<{
      readonly output: TOutput
      readonly children: TArguments[number]
      readonly kind: "function"
    }>
}
