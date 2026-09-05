import { asc, fetchFirst, from, orderBy, render, select, table } from "qubu"
import { expectTypeOf } from "vitest"

import { pgvector } from "../src/index.ts"
import type { PgVector } from "../src/index.ts"

const items = table("items", {
  embedding: pgvector.vector(3),
})
const distance = pgvector.cosineDistance(items.embedding, [1, 2, 3])
const query = select(
  { distance },
  from(items),
  // A distance is a decimal result and can be ordered for nearest-neighbor search.
  orderBy(asc(distance)),
  fetchFirst(5),
)

expectTypeOf<import("qubu").OutputOf<typeof items.embedding>>().toEqualTypeOf<PgVector<3>>()
expectTypeOf<import("qubu").OutputOf<typeof distance>>().toEqualTypeOf<number>()
expectTypeOf(query.row).toEqualTypeOf<{ distance: number }>()
expectTypeOf(render(query, pgvector.dialect())).toMatchTypeOf<{
  readonly text: string
  readonly parameters: readonly unknown[]
}>()

// @ts-expect-error pgvector operators require the addon dialect capability.
render(query)
