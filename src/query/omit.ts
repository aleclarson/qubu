import type { DistinctClause } from "./clauses/distinct.ts"
import type { HavingClause } from "./clauses/having.ts"
import type { OrderByClause } from "./clauses/order-by.ts"
import type { FetchClause, OffsetClause } from "./clauses/pagination.ts"
import type { RowLockClause } from "./clauses/row-lock.ts"
import type { AnySelectClause } from "./clauses/types.ts"
import type { WhereClause } from "./clauses/where.ts"
import type { QueryTypeValidation } from "./errors.ts"

/**
 * Omit a supported SELECT clause, projection field, boolean/order term, or UPDATE assignment.
 *
 * This is distinct from `null` and `undefined`. FROM, joins, grouping, CTEs, correlation, and
 * custom clauses cannot be conditionally omitted. Generic fragment collections do not discard the
 * token.
 */
export const omit: unique symbol = Symbol("qubu.omit")

export type Omit = typeof omit

export type OmittableSelectClause =
  | DistinctClause
  | HavingClause<any>
  | OrderByClause<any>
  | OffsetClause
  | FetchClause
  | RowLockClause
  | WhereClause<any>

export type SelectPart = AnySelectClause | Omit

export type PresentClauses<TParts extends readonly SelectPart[]> = {
  readonly [TIndex in keyof TParts]: Exclude<TParts[TIndex], Omit>
}

type InvalidOmittedClauses<TParts extends readonly SelectPart[]> = {
  [TIndex in keyof TParts]: Omit extends TParts[TIndex]
    ? Exclude<TParts[TIndex], Omit> extends OmittableSelectClause
      ? never
      : Exclude<TParts[TIndex], Omit>
    : never
}[number]

export type OmissionValidation<TParts extends readonly SelectPart[]> = [
  InvalidOmittedClauses<TParts>,
] extends [never]
  ? unknown
  : QueryTypeValidation<
      "invalid-omission",
      "select.omit",
      "Use omit only for a conditional SELECT clause or projection field.",
      InvalidOmittedClauses<TParts>
    >
