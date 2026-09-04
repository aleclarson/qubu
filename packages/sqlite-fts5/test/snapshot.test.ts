import { integer, schema, table, text } from "qubu"
import { describe, expect, test } from "vitest"

import { fts5 } from "../src/index.ts"

describe("fts5 snapshots", () => {
  test("preserves observed FTS tables when synchronization triggers are missing", () => {
    const documents = table("documents", {
      id: integer(),
      title: text(),
    })
    const search = fts5.table({
      name: "search",
      content: documents,
      contentRowid: documents.id,
      columns: { title: documents.title },
    })
    const observed = {
      ...fts5.snapshot.create(schema({ documents }), []),
      deferredObjects: [
        {
          kind: "deferred-object" as const,
          id: "search",
          physicalName: "search",
          objectKind: "virtual-table",
          data: { createSql: search.fts5.createSql },
        },
      ],
    }

    expect(fts5.snapshot.normalize(observed, [search])).toBe(observed)
    expect(observed.opaqueObjects).toHaveLength(0)
  })

  test("does not normalize different quoted FTS option values", () => {
    const search = fts5.table({
      name: "search",
      columns: { title: text() },
      tokenize: "unicode61 tokenchars 'X'",
    })
    const observed = {
      ...fts5.snapshot.create(schema({}), []),
      deferredObjects: [
        {
          kind: "deferred-object" as const,
          id: "search",
          physicalName: "search",
          objectKind: "virtual-table",
          data: { createSql: search.fts5.createSql.replace("X", "x") },
        },
      ],
    }

    expect(fts5.snapshot.normalize(observed, [search])).toBe(observed)
  })

  test("records one addon-owned object with install and uninstall SQL", () => {
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

    const snapshot = fts5.snapshot.create(schema({ documents }), [search])
    const object = snapshot.opaqueObjects.find(
      (candidate) => candidate.objectKind === "sqlite-fts5",
    )

    expect(object).toMatchObject({
      objectKind: "sqlite-fts5",
      physicalName: "documents_fts",
      sql: {
        expressionKind: "sqlite-fts5-create",
        sql: 'CREATE VIRTUAL TABLE "documents_fts" USING fts5("title", "body", content=\'documents\', content_rowid=\'id\')',
      },
    })
    expect(object?.data).toMatchObject({ module: "fts5" })
    if (object === undefined || typeof object.data !== "object" || object.data === null) {
      return
    }

    const statements = (
      object.data as { readonly statements: { readonly install: readonly string[] } }
    ).statements

    expect(statements.install).toContain(
      'INSERT INTO "documents_fts" ("rowid", "title", "body") SELECT "id", "title", "body" FROM "documents"',
    )
    expect(
      statements.install.some((statement) =>
        statement.startsWith('CREATE TRIGGER "documents_fts_ai" AFTER INSERT ON "documents"'),
      ),
    ).toBe(true)
  })
})
