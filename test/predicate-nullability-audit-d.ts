import { expectTypeOf } from "vitest"

import {
  between,
  eq,
  exists,
  from,
  inList,
  inQuery,
  integer,
  isDistinctFrom,
  isNull,
  not,
  select,
  table,
  where,
} from "../src/index.ts"

const measurements = table("audit_measurements", { score: integer({ nullable: true }) })
const scores = select({ score: measurements.score }, from(measurements))
const predicates = select(
  {
    score: measurements.score,
    equal: eq(measurements.score, 1),
    range: between(measurements.score, 0, 10),
    member: inList(measurements.score, [1]),
    subqueryMember: inQuery(measurements.score, scores),
    negated: not(eq(measurements.score, 1)),
    missing: isNull(measurements.score),
    distinct: isDistinctFrom(measurements.score, 1),
    anyRows: exists(scores),
  },
  from(measurements),
)

// SQL UNKNOWN is returned as NULL when projected. This is independent of
// whether the source participates in an outer join.
expectTypeOf(predicates.row.score).toEqualTypeOf<number | null>()
expectTypeOf(predicates.row.equal).toEqualTypeOf<boolean | null>()
expectTypeOf(predicates.row.range).toEqualTypeOf<boolean | null>()
expectTypeOf(predicates.row.member).toEqualTypeOf<boolean | null>()
expectTypeOf(predicates.row.subqueryMember).toEqualTypeOf<boolean | null>()
expectTypeOf(predicates.row.negated).toEqualTypeOf<boolean | null>()

// These operators always resolve SQL UNKNOWN to a definite boolean.
expectTypeOf(predicates.row.missing).toEqualTypeOf<boolean>()
expectTypeOf(predicates.row.distinct).toEqualTypeOf<boolean>()
expectTypeOf(predicates.row.anyRows).toEqualTypeOf<boolean>()

const candidates = table("audit_candidates", { id: integer() })
const matching = select(
  { id: candidates.id },
  from(candidates),
  // NULL rows in an IN subquery are legal SQL. They do not make the integer
  // domains incompatible or make a matching candidate's id nullable.
  where(inQuery(candidates.id, scores)),
)

expectTypeOf(matching.row.id).toEqualTypeOf<number>()
