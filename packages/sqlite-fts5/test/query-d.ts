import { asc, eq, from, innerJoin, integer, render, select, table, text, where } from "qubu"
import { expectTypeOf } from "vitest"

import { fts5 } from "../src/index.ts"

const documents = table("documents", {
  id: integer(),
  title: text(),
  body: text(),
})
const search = fts5.table({
  name: "documents_fts",
  content: documents,
  contentRowid: documents.id,
  columns: {
    title: documents.title,
    body: documents.body,
  },
})
const rank = fts5.bm25(search)
const query = select(
  {
    id: documents.id,
    rank,
    excerpt: fts5.snippet(search, "body", "<b>", "</b>"),
  },
  from(documents),
  innerJoin(search, eq(documents.id, search.rowid)),
  where(fts5.match(search, "term")),
)

expectTypeOf<import("qubu").OutputOf<typeof search.rowid>>().toEqualTypeOf<number>()
expectTypeOf<import("qubu").OutputOf<typeof rank>>().toEqualTypeOf<number>()
expectTypeOf(query.row).toEqualTypeOf<{
  id: number
  rank: number
  excerpt: string | null
}>()
expectTypeOf(render(query, fts5.dialect())).toMatchTypeOf<{
  readonly text: string
  readonly parameters: readonly unknown[]
}>()

// @ts-expect-error FTS5 syntax requires the addon dialect.
render(query)

// @ts-expect-error The FTS5 source must be present in the query scope.
select({ title: search.title }, from(documents), where(fts5.match(search, "term")))

void asc(rank)
