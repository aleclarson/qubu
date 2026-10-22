import { except, intersect, select, union, unionAll, value } from "../src/index.ts"

const left = select({ id: value(1) })
const matching = select({ id: value(2) })
const extraColumn = select({
  id: value(2),
  extra: value(3),
})

union(left, matching)
unionAll(left, matching)
intersect(left, matching)
except(left, matching)

// @ts-expect-error UNION operands must have the same number of projected fields.
union(left, extraColumn)

// @ts-expect-error UNION ALL operands must have the same number of projected fields.
unionAll(left, extraColumn)

// @ts-expect-error INTERSECT operands must have the same number of projected fields.
intersect(left, extraColumn)

// @ts-expect-error EXCEPT operands must have the same number of projected fields.
except(left, extraColumn)
