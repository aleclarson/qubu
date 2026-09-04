import { DatabaseSync, type SQLInputValue } from "node:sqlite"

import {
  asc,
  eq,
  executeRows,
  from,
  innerJoin,
  integer,
  orderBy,
  select,
  table,
  text,
  where,
} from "qubu"
import type { ExecutionRequest, QueryAdapter } from "qubu"
import { expect, test } from "vitest"

import { fts5 } from "../src/index.ts"

test("indexes and searches external content through node:sqlite", async () => {
  const database = new DatabaseSync(":memory:")
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
      title: documents.title,
      excerpt: fts5.highlight(search, "body", "<mark>", "</mark>"),
      rank,
    },
    from(documents),
    innerJoin(search, eq(documents.id, search.rowid)),
    where(fts5.match(search, "SQLite")),
    orderBy(asc(rank)),
  )
  const adapter: QueryAdapter = {
    dialect: fts5.dialect(),
    async execute(request: ExecutionRequest) {
      const statement = database.prepare(request.statement.text)

      return {
        rows: statement.all(
          ...(request.statement.parameters as SQLInputValue[]),
        ) as readonly Readonly<Record<string, unknown>>[],
      }
    },
  }

  try {
    database.exec("CREATE TABLE documents (id INTEGER PRIMARY KEY, title TEXT, body TEXT)")
    database.exec(
      "INSERT INTO documents (id, title, body) VALUES (1, 'SQLite', 'Qubu supports SQLite search'), (2, 'Other', 'No matching term')",
    )
    for (const statement of search.fts5.installSql) {
      database.exec(statement)
    }

    await expect(executeRows(query, adapter)).resolves.toEqual([
      {
        id: 1,
        title: "SQLite",
        excerpt: "Qubu supports <mark>SQLite</mark> search",
        rank: expect.any(Number),
      },
    ])

    database.exec("UPDATE documents SET body = 'Updated SQLite content' WHERE id = 2")
    await expect(executeRows(query, adapter)).resolves.toEqual([
      {
        id: 1,
        title: "SQLite",
        excerpt: "Qubu supports <mark>SQLite</mark> search",
        rank: expect.any(Number),
      },
      {
        id: 2,
        title: "Other",
        excerpt: "Updated <mark>SQLite</mark> content",
        rank: expect.any(Number),
      },
    ])
  } finally {
    database.close()
  }
})
