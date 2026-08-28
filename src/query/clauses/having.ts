import type { InheritedMetadata } from "../../core/fragment.ts"
import type { SqlBoolean } from "../../core/sql-types.ts"
import type { BooleanExpression } from "../../expressions/operators/comparison.ts"
import type { SqlCapabilityValidation } from "../../expressions/operators/shared.ts"
import type { ExpressionSqlType } from "../../expressions/types.ts"
import { omit, type Omit } from "../omit.ts"
import { createClause, type SelectClause } from "./types.ts"

export interface HavingClause<TMetadata = never> extends SelectClause<TMetadata> {
  readonly clauseKind: "having"
  readonly condition: BooleanExpression<any>
}

type HavingComposition<TCondition extends BooleanExpression<any> | Omit> = TCondition extends Omit
  ? Omit
  : TCondition extends BooleanExpression<any>
    ? HavingClause<InheritedMetadata<TCondition>>
    : never

type HavingValidation<TCondition> = TCondition extends Omit
  ? unknown
  : SqlCapabilityValidation<ExpressionSqlType<TCondition>, SqlBoolean>

export function having<TCondition extends BooleanExpression<any> | Omit>(
  condition: TCondition & HavingValidation<TCondition>,
): HavingComposition<TCondition> {
  if (condition === omit) {
    return omit as HavingComposition<TCondition>
  }

  return Object.assign(
    createClause("having", "after-select", 70, (context) => {
      context.append("HAVING ")
      context.render(condition)
    }),
    {
      clauseKind: "having" as const,
      condition,
    },
  ) as unknown as HavingComposition<TCondition>
}
