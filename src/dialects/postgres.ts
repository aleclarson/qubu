import {
  createDialect,
  type DialectRowLocking,
  type PaginationPart,
  type RowLockMode,
  type RowLockWaitPolicy,
} from "../core/dialect.ts"
import type { RenderContext } from "../core/fragment.ts"
import {
  comparison,
  type ComparisonValidation,
} from "../expressions/operators/comparison/relational.ts"
import type { Operand } from "../expressions/operators/shared.ts"
import { withDialectCapability, type ExpressionWithOutput } from "../expressions/types.ts"
import { postgresExplain } from "./explain.ts"
import { postgresJson } from "./json.ts"

const postgresRowLockModeSql: Record<RowLockMode, string> = {
  update: "UPDATE",
  "no-key-update": "NO KEY UPDATE",
  share: "SHARE",
  "key-share": "KEY SHARE",
}

const postgresRowLocking: DialectRowLocking = {
  render(context, mode: RowLockMode, wait: RowLockWaitPolicy) {
    context.append(`FOR ${postgresRowLockModeSql[mode]}`)
    if (wait === "nowait") {
      context.append(" NOWAIT")
    }

    if (wait === "skip-locked") {
      context.append(" SKIP LOCKED")
    }
  },
}

const postgresPagination = {
  render(context: RenderContext, parts: readonly PaginationPart[]) {
    const ordered = [...parts].sort((left, right) => {
      const leftOrder = left.kind === "fetch" ? 0 : 1
      const rightOrder = right.kind === "fetch" ? 0 : 1

      return leftOrder - rightOrder
    })

    ordered.forEach((part, index) => {
      if (index > 0) {
        context.append(" ")
      }

      context.append(part.kind === "fetch" ? "LIMIT " : "OFFSET ")
      context.parameter(part.rows)
    })
  },
}

/**
 * PostgreSQL's only core rendering difference is positional parameters. PostgreSQL-specific
 * expressions and clauses should remain separate modules.
 */
export function postgresDialect() {
  return createDialect({
    name: "postgresql",
    placeholder: (position) => `$${position}`,
    pagination: postgresPagination,
    rowLocking: postgresRowLocking,
    castTypes: { binary: "BYTEA" },
    capabilities: ["ilike", "on-conflict", "row-locking"],
    json: postgresJson,
    explain: postgresExplain,
  })
}

export { doNothing, doUpdate, excluded, onConflict } from "../query/mutation/on-conflict.ts"
export type {
  ConflictAction,
  ConflictTarget,
  DoNothingAction,
  DoUpdateAction,
  ExcludedSource,
  OnConflictClause,
} from "../query/mutation/on-conflict.ts"

/** PostgreSQL's case-insensitive pattern-match operator. */
export function ilike<TLeft extends ExpressionWithOutput<string>, R extends Operand<string>>(
  left: TLeft & ComparisonValidation<TLeft, R, "ILIKE">,
  pattern: R,
) {
  return withDialectCapability(comparison("ILIKE", left, pattern), "ilike")
}
