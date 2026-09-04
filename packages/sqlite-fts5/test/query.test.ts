import {
  asc,
  eq,
  from,
  innerJoin,
  integer,
  orderBy,
  render,
  select,
  table,
  text,
  where,
} from "qubu"
import { describe, expect, test } from "vitest"

import { fts5 } from "../src/index.ts"

describe("fts5 namespace", () => {
  test("renders typed MATCH, BM25, and highlight expressions", () => {
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
      prefix: [3, 2, 3],
      tokenize: "unicode61 remove_diacritics 2",
    })
    const rank = fts5.bm25(search, [2, 3, 3])
    const query = select(
      {
        id: documents.id,
        title: documents.title,
        rank,
        excerpt: fts5.highlight(search, "body", "<mark>", "</mark>"),
      },
      from(documents),
      innerJoin(search, eq(documents.id, search.rowid)),
      where(fts5.match(search, "SQLite search")),
      orderBy(asc(rank)),
    )

    expect(render(query, fts5.dialect())).toEqual({
      text: 'SELECT "documents"."id" AS "id", "documents"."title" AS "title", bm25("documents_fts", ?, ?, ?) AS "rank", highlight("documents_fts", 1, ?, ?) AS "excerpt" FROM "documents" INNER JOIN "documents_fts" ON ("documents"."id" = "documents_fts"."rowid") WHERE ("documents_fts" MATCH ?) ORDER BY bm25("documents_fts", ?, ?, ?) ASC',
      parameters: [2, 3, 3, "<mark>", "</mark>", "SQLite search", 2, 3, 3],
      parameterSqlTypes: [
        "decimal",
        "decimal",
        "decimal",
        "text",
        "text",
        "text",
        "decimal",
        "decimal",
        "decimal",
      ],
    })
  })

  test("rejects a dialect without the FTS5 capability at runtime", () => {
    const documents = table("documents", {
      id: integer(),
      body: text(),
    })
    const search = fts5.table({
      name: "documents_fts",
      content: documents,
      contentRowid: documents.id,
      columns: { body: documents.body },
    })

    expect(() =>
      render(select({ body: search.body }, from(search)), { dialect: undefined }),
    ).toThrow('Dialect "standard-sql" does not support the "sqlite-fts5" capability')
  })
})
