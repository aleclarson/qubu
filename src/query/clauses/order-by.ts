import { type Fragment, type InheritedMetadata } from "../../core/fragment.ts"
import type { SqlOrderable } from "../../core/sql-types.ts"
import type { SqlCapabilityValidation } from "../../expressions/operators/shared.ts"
import { makeExpression, type AnyExpression } from "../../expressions/types.ts"
import type { ExpressionSqlType } from "../../expressions/types.ts"
import { omit, type Omit } from "../omit.ts"
import { createClause, type SelectClause } from "./types.ts"

export type OrderDirection = "ASC" | "DESC"
export type NullsOrder = "FIRST" | "LAST"

export interface OrderTerm<
  TMetadata = never,
  TExpression extends AnyExpression = AnyExpression,
> extends Fragment<TMetadata> {
  readonly orderKind: "term"
  readonly expression: TExpression
  readonly direction?: OrderDirection
  readonly nulls?: NullsOrder
}

function orderTerm<TExpression extends AnyExpression>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlOrderable>,
  direction?: OrderDirection,
  nulls?: NullsOrder,
): OrderTerm<InheritedMetadata<TExpression>, TExpression> {
  const base = makeExpression<InheritedMetadata<TExpression>, "operator">("operator", (context) => {
    context.render(expression)
    if (direction) {
      context.append(` ${direction}`)
    }

    if (nulls) {
      context.append(` NULLS ${nulls}`)
    }
  })

  return Object.freeze({
    ...base,
    orderKind: "term" as const,
    expression,
    direction,
    nulls,
  }) as OrderTerm<InheritedMetadata<TExpression>, TExpression>
}

export function order<TExpression extends AnyExpression>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlOrderable>,
  direction?: OrderDirection,
  nulls?: NullsOrder,
) {
  return orderTerm(expression, direction, nulls)
}

export function asc<TExpression extends AnyExpression>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlOrderable>,
  nulls?: NullsOrder,
) {
  return orderTerm(expression, "ASC", nulls)
}

export function desc<TExpression extends AnyExpression>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlOrderable>,
  nulls?: NullsOrder,
) {
  return orderTerm(expression, "DESC", nulls)
}

export function nullsFirst<TExpression extends AnyExpression>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlOrderable>,
) {
  return orderTerm(expression, undefined, "FIRST")
}

export function nullsLast<TExpression extends AnyExpression>(
  expression: TExpression & SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlOrderable>,
) {
  return orderTerm(expression, undefined, "LAST")
}

export interface OrderByClause<TMetadata = never> extends SelectClause<TMetadata> {
  readonly clauseKind: "order-by"
  readonly terms: readonly OrderTerm<any>[]
}

type OrderByPart = AnyExpression | OrderTerm<any> | Omit
type PresentOrderParts<TParts extends readonly OrderByPart[]> = Exclude<TParts[number], Omit>
type OrderByComposition<TParts extends readonly OrderByPart[]> = [
  PresentOrderParts<TParts>,
] extends [never]
  ? Omit
  :
      | OrderByClause<InheritedMetadata<PresentOrderParts<TParts>>>
      | (Omit extends TParts[number] ? Omit : never)

type OrderPartsValidation<TParts extends readonly unknown[]> = TParts extends readonly [
  infer THead,
  ...infer TTail,
]
  ? (THead extends Omit
      ? unknown
      : THead extends AnyExpression
        ? SqlCapabilityValidation<ExpressionSqlType<THead>, SqlOrderable>
        : unknown) &
      OrderPartsValidation<TTail>
  : unknown

export function orderBy<const TParts extends readonly OrderByPart[]>(
  ...parts: TParts & OrderPartsValidation<TParts>
): OrderByComposition<TParts> {
  const presentParts = parts.filter((part): part is PresentOrderParts<TParts> => part !== omit)

  if (presentParts.length === 0) {
    return omit as OrderByComposition<TParts>
  }

  const terms = presentParts.map((part) => ("orderKind" in part ? part : orderTerm(part as never)))

  return Object.assign(
    createClause("order-by", "after-select", 80, (context) => {
      context.append("ORDER BY ")
      terms.forEach((term, index) => {
        if (index > 0) {
          context.append(", ")
        }

        context.render(term)
      })
    }),
    {
      clauseKind: "order-by" as const,
      terms,
    },
  ) as unknown as OrderByComposition<TParts>
}
