import type { ExpressionMeta, ResultMeta } from "../core/fragment.ts"
import { parameter } from "../core/primitives/parameter.ts"
import type { AnySqlType, SqlTypeName, SqlUnknown } from "../core/sql-types.ts"
import { resultValue } from "../result.ts"
import { makeSchemaExpression, type AnyExpression, type SchemaExpression } from "./types.ts"

export interface ValueExpression<
  T = unknown,
  TSqlType extends AnySqlType = SqlUnknown,
> extends SchemaExpression<ResultMeta<T, never, TSqlType> | ExpressionMeta<never>, "value"> {
  readonly value: T
}

/** Build a parameterized value expression with an optional runtime SQL domain for the adapter. */
export function value<T>(input: T, sqlType?: SqlTypeName): ValueExpression<T> {
  const expression = makeSchemaExpression<ResultMeta<T> | ExpressionMeta<never>, "value">(
    "value",
    (context) => context.render(parameter(input, sqlType)),
    resultValue(undefined, undefined, sqlType),
  )

  return Object.freeze({
    ...expression,
    value: input,
  })
}

/**
 * Bind a value while declaring its compile-time and runtime SQL semantic domain.
 *
 * @remarks
 *   The domain is a binding hint; it does not select a JavaScript result decoder.
 */
export function typedValue<TSqlType extends AnySqlType, T>(
  input: T,
  sqlType: TSqlType["sqlType"],
): ValueExpression<T, TSqlType> {
  return value(input, sqlType) as unknown as ValueExpression<T, TSqlType>
}

export function isExpressionValue(valueToCheck: unknown): valueToCheck is AnyExpression {
  return (
    typeof valueToCheck === "object" &&
    valueToCheck !== null &&
    "expressionKind" in valueToCheck &&
    "render" in valueToCheck &&
    typeof valueToCheck.render === "function"
  )
}

export function isValueExpression(valueToCheck: unknown): valueToCheck is ValueExpression {
  return (
    isExpressionValue(valueToCheck) &&
    valueToCheck.expressionKind === "value" &&
    "value" in valueToCheck
  )
}

export function asValue<TInput>(
  input: TInput,
  sqlType?: SqlTypeName,
): TInput extends AnyExpression ? TInput : ValueExpression<TInput>
export function asValue(input: unknown, sqlType?: SqlTypeName): AnyExpression {
  return isExpressionValue(input) ? input : value(input, sqlType)
}
