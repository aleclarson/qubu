import { expectTypeOf } from "vitest"

import {
  count,
  from,
  groupBy,
  integer,
  over,
  rowNumber,
  select,
  table,
  text,
} from "../src/index.ts"

const accounts = table("audit_window_accounts", {
  id: integer(),
  name: text(),
})

// A windowed COUNT preserves the input rows and does not require GROUP BY.
const totals = select(
  {
    id: accounts.id,
    total: over(count()),
  },
  from(accounts),
)

expectTypeOf(totals.row).toEqualTypeOf<{
  id: number
  total: number
}>()

// After grouping, a window's argument must reference grouped columns or the
// results of ordinary aggregates. OVER does not consume an ungrouped column.
select(
  {
    name: accounts.name,
    total: over(count(accounts.id)),
  },
  // @ts-expect-error The window argument accounts.id is not grouped.
  from(accounts),
  groupBy(accounts.name),
)

const ranked = select(
  {
    id: accounts.id,
    rank: over(rowNumber()),
  },
  from(accounts),
)

expectTypeOf(ranked.row).toEqualTypeOf<{
  id: number
  rank: number
}>()
