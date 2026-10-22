import { expectTypeOf } from "vitest"

import { avg, count, from, max, min, numeric, select, sum, table } from "../src/index.ts"

const invoices = table("audit_invoices", { amount: numeric() })
const totals = select(
  {
    sum: sum(invoices.amount),
    average: avg(invoices.amount),
    minimum: min(invoices.amount),
    maximum: max(invoices.amount),
    count: count(),
  },
  from(invoices),
)

// A non-null column does not guarantee any input rows. These four aggregates
// return NULL for an empty table; COUNT still returns zero.
expectTypeOf(totals.row.sum).toEqualTypeOf<number | null>()
expectTypeOf(totals.row.average).toEqualTypeOf<number | null>()
expectTypeOf(totals.row.minimum).toEqualTypeOf<number | null>()
expectTypeOf(totals.row.maximum).toEqualTypeOf<number | null>()
expectTypeOf(totals.row.count).toEqualTypeOf<number>()
