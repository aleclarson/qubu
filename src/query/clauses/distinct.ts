import { createClause, type SelectClause } from "./types.ts"

export interface DistinctClause extends SelectClause<never> {
  readonly clauseKind: "distinct"
}

export function distinct(): DistinctClause {
  return Object.assign(
    createClause("distinct", "after-select", 20, (context) => {
      context.append("DISTINCT")
    }),
    { clauseKind: "distinct" as const },
  )
}
