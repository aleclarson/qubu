import { type GroupingMeta, type InheritedMetadata } from "../../core/fragment.ts"
import type { ColumnGroupingDependencies } from "../../expressions/column.ts"
import type { AnyExpression } from "../../expressions/types.ts"
import { createClause, type SelectClause } from "./types.ts"

export interface GroupByClause<TMetadata = never> extends SelectClause<TMetadata> {
  readonly clauseKind: "group-by"
  readonly expressions: readonly AnyExpression[]
}

export function groupBy<const TExpressions extends readonly AnyExpression[]>(
  ...expressions: TExpressions
): GroupByClause<
  | GroupingMeta<TExpressions[number], ColumnGroupingDependencies<TExpressions[number]>>
  | InheritedMetadata<TExpressions[number]>
> {
  return Object.assign(
    createClause("group-by", "after-select", 60, (context) => {
      context.append("GROUP BY ")
      expressions.forEach((expression, index) => {
        if (index > 0) {
          context.append(", ")
        }

        context.render(expression)
      })
    }),
    {
      clauseKind: "group-by" as const,
      expressions,
    },
  ) as GroupByClause<
    | GroupingMeta<TExpressions[number], ColumnGroupingDependencies<TExpressions[number]>>
    | InheritedMetadata<TExpressions[number]>
  >
}
