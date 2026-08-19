import type { DistinctClause } from './clauses/distinct.ts'
import type { HavingClause } from './clauses/having.ts'
import type { OrderByClause } from './clauses/order-by.ts'
import type { WhereClause } from './clauses/where.ts'
import type { AnySelectClause } from './clauses/types.ts'

/** An explicit placeholder for a safely omitted SELECT clause. */
export const omit: unique symbol = Symbol('qubu.omit')

export type Omit = typeof omit

export type OmittableSelectClause =
  | DistinctClause
  | HavingClause<any>
  | OrderByClause<any>
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
  : {
      readonly __invalid_omitted_clauses__: InvalidOmittedClauses<TParts>
    }
