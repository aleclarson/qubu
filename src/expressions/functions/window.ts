import {
  type DependenciesOf,
  type ExpressionMeta,
  type InheritedMetadata,
  type NullabilityOf,
  type OutputOf,
  type ResultMeta,
  type SqlTypeOf,
  type WindowMeta,
} from "../../core/fragment.ts"
import type { OrderTerm } from "../../query/clauses/order-by.ts"
import { attachResultValue, resultValue, resultValueOf } from "../../result.ts"
import {
  makeExpression,
  markExpressionCategory,
  type AnyExpression,
  type Expression,
} from "../types.ts"
import { call } from "./call.ts"

export type WindowOrder = AnyExpression | OrderTerm<any>

/**
 * The initial inline window scope. Named windows and frame clauses can be added at a later
 * dialect-aware boundary without changing expression types.
 */
export interface WindowSpec {
  readonly partitionBy?: readonly AnyExpression[]
  readonly orderBy?: readonly WindowOrder[]
}

type FragmentItems<T> = T extends readonly unknown[] ? T[number] : never

type WindowSpecParts<TWindow> = TWindow extends WindowSpec
  ? FragmentItems<TWindow["partitionBy"]> | FragmentItems<TWindow["orderBy"]>
  : never

export type WindowedExpression<
  TExpression extends AnyExpression,
  TWindow extends WindowSpec | undefined,
> = Expression<
  | ResultMeta<OutputOf<TExpression>, NullabilityOf<TExpression>, SqlTypeOf<TExpression>>
  | ExpressionMeta<DependenciesOf<TExpression | WindowSpecParts<TWindow>>>
  | InheritedMetadata<TExpression | WindowSpecParts<TWindow>>
  | WindowMeta,
  "function"
>

export function over<
  TExpression extends AnyExpression,
  const TWindow extends WindowSpec | undefined = undefined,
>(expression: TExpression, window?: TWindow): WindowedExpression<TExpression, TWindow> {
  return makeExpression(
    "function",
    (context) => {
      context.render(expression)
      context.append(" OVER (")

      let hasPart = false

      if (window?.partitionBy && window.partitionBy.length > 0) {
        context.append("PARTITION BY ")
        window.partitionBy.forEach((part, index) => {
          if (index > 0) {
            context.append(", ")
          }

          context.render(part)
        })
        hasPart = true
      }

      if (window?.orderBy && window.orderBy.length > 0) {
        if (hasPart) {
          context.append(" ")
        }

        context.append("ORDER BY ")
        window.orderBy.forEach((part, index) => {
          if (index > 0) {
            context.append(", ")
          }

          context.render(part)
        })
      }

      context.append(")")
    },
    "window",
    resultValueOf(expression),
  ) as WindowedExpression<TExpression, TWindow>
}

export function rowNumber() {
  return markExpressionCategory(
    attachResultValue(
      call<number, "ROW_NUMBER", [], never, import("../../core/sql-types.ts").SqlInteger>(
        "ROW_NUMBER",
      ),
      resultValue(undefined, undefined, "integer"),
    ),
    "window",
  )
}

export function rank() {
  return markExpressionCategory(
    attachResultValue(
      call<number, "RANK", [], never, import("../../core/sql-types.ts").SqlInteger>("RANK"),
      resultValue(undefined, undefined, "integer"),
    ),
    "window",
  )
}

export function denseRank() {
  return markExpressionCategory(
    attachResultValue(
      call<number, "DENSE_RANK", [], never, import("../../core/sql-types.ts").SqlInteger>(
        "DENSE_RANK",
      ),
      resultValue(undefined, undefined, "integer"),
    ),
    "window",
  )
}
