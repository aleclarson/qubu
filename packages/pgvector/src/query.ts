import type {
  AnyExpression,
  Expression,
  ExpressionWithOutput,
} from "qubu"
import {
  assertDialectCapability,
  makeExpression,
  resultValue,
} from "qubu/core"
import type {
  InheritedMetadata,
  NullabilityOf,
  RequiresCapabilityMeta,
  ResultMeta,
} from "qubu/core"
import type { SqlDecimal } from "qubu/core"
import { toSql, type PgVector } from "./vector.ts"

export const pgvectorCapability = "postgres-pgvector" as const

type VectorOperand<TDimensions extends number> =
  | PgVector<TDimensions>
  | ExpressionWithOutput<PgVector<TDimensions>>

type VectorDistanceExpression<
  TLeft extends AnyExpression,
  TRight extends AnyExpression | readonly number[],
> = Expression<
  | ResultMeta<number, NullabilityOf<TLeft | Extract<TRight, AnyExpression>>, SqlDecimal>
  | InheritedMetadata<TLeft | Extract<TRight, AnyExpression>>
  | RequiresCapabilityMeta<typeof pgvectorCapability>,
  "operator"
>

export type PgVectorDistanceExpression = VectorDistanceExpression<AnyExpression, AnyExpression>

/** Return L2 (Euclidean) distance using pgvector's indexable `<->` operator. */
export function l2Distance<
  TDimensions extends number,
  TLeft extends ExpressionWithOutput<PgVector<TDimensions>>,
  TRight extends VectorOperand<TDimensions>,
>(left: TLeft, right: TRight): VectorDistanceExpression<TLeft, TRight> {
  return distance("<->", left, right)
}

/** Return negative inner product using pgvector's indexable `<#>` operator. */
export function negativeInnerProduct<
  TDimensions extends number,
  TLeft extends ExpressionWithOutput<PgVector<TDimensions>>,
  TRight extends VectorOperand<TDimensions>,
>(left: TLeft, right: TRight): VectorDistanceExpression<TLeft, TRight> {
  return distance("<#>", left, right)
}

/** Return cosine distance using pgvector's indexable `<=>` operator. */
export function cosineDistance<
  TDimensions extends number,
  TLeft extends ExpressionWithOutput<PgVector<TDimensions>>,
  TRight extends VectorOperand<TDimensions>,
>(left: TLeft, right: TRight): VectorDistanceExpression<TLeft, TRight> {
  return distance("<=>", left, right)
}

/** Return L1 (Manhattan) distance using pgvector's indexable `<+>` operator. */
export function l1Distance<
  TDimensions extends number,
  TLeft extends ExpressionWithOutput<PgVector<TDimensions>>,
  TRight extends VectorOperand<TDimensions>,
>(left: TLeft, right: TRight): VectorDistanceExpression<TLeft, TRight> {
  return distance("<+>", left, right)
}

function distance<
  TDimensions extends number,
  TLeft extends ExpressionWithOutput<PgVector<TDimensions>>,
  TRight extends VectorOperand<TDimensions>,
>(operator: string, left: TLeft, right: TRight): VectorDistanceExpression<TLeft, TRight> {
  const rightExpression = isExpression(right) ? right : undefined

  return makeExpression(
    "operator",
    (context) => {
      assertDialectCapability(context.dialect, pgvectorCapability)
      context.render(left)
      context.append(` ${operator} `)
      if (rightExpression !== undefined) {
        context.render(rightExpression)
      } else {
        context.parameter(toSql(right as readonly number[]), "postgres.vector")
      }
    },
    undefined,
    resultValue(undefined, undefined, "decimal"),
  ) as VectorDistanceExpression<TLeft, TRight>
}

function isExpression(value: unknown): value is AnyExpression {
  return (
    typeof value === "object" &&
    value !== null &&
    "expressionKind" in value &&
    "render" in value &&
    typeof value.render === "function"
  )
}
