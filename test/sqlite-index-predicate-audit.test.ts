import { expect, test } from "vitest"

import type {
  CatalogConnection,
  CatalogQuery,
  CatalogQueryRow,
} from "../src/introspection/index.ts"
import {
  readCatalog,
  sqliteDatabaseListQuery,
  sqliteIndexInfoQuery,
  sqliteIndexListQuery,
  sqliteSchemaQuery,
  sqliteServerQuery,
  sqliteTableInfoQuery,
  sqliteTableListQuery,
} from "../src/introspection/sqlite.ts"

function indexCatalog(indexName: string, definition: string): CatalogConnection {
  // These rows match SQLite's catalog for a one-column table and a partial
  // expression index. SQL parsing belongs to Qubu, so no live engine is needed.
  const rows = new Map<string, readonly CatalogQueryRow[]>([
    [
      sqliteServerQuery,
      [
        {
          version: "3.45.1",
          source_id: "audit",
        },
      ],
    ],
    [
      sqliteDatabaseListQuery,
      [
        {
          seq: 0,
          name: "main",
          file: "",
        },
      ],
    ],
    [
      sqliteSchemaQuery,
      [
        {
          type: "table",
          name: "audit_labels",
          tbl_name: "audit_labels",
          sql: "CREATE TABLE audit_labels (label TEXT)",
        },
        {
          type: "index",
          name: indexName,
          tbl_name: "audit_labels",
          sql: definition,
        },
      ],
    ],
    [
      sqliteTableListQuery,
      [
        {
          schema: "main",
          name: "audit_labels",
          type: "table",
          ncol: 1,
          wr: 0,
          strict: 0,
        },
      ],
    ],
    [
      sqliteTableInfoQuery,
      [
        {
          cid: 0,
          name: "label",
          type: "TEXT",
          not_null: 0,
          dflt_value: null,
          pk: 0,
          hidden: 0,
        },
      ],
    ],
    [
      sqliteIndexListQuery,
      [
        {
          seq: 0,
          name: indexName,
          unique_index: 0,
          origin: "c",
          partial: 1,
        },
      ],
    ],
    [
      sqliteIndexInfoQuery,
      [
        {
          seqno: 0,
          cid: -2,
          name: null,
          descending: 0,
          coll: "BINARY",
          key: 1,
        },
        {
          seqno: 1,
          cid: -1,
          name: null,
          descending: 0,
          coll: "BINARY",
          key: 0,
        },
      ],
    ],
  ])

  return {
    dialect: "sqlite",
    async query<TRow extends CatalogQueryRow = CatalogQueryRow>(statement: CatalogQuery) {
      return (rows.get(statement.text) ?? []) as readonly TRow[]
    },
  }
}

test.each([
  {
    context: "an ordinary expression index",
    name: "audit_plain",
    definition: "CREATE INDEX audit_plain ON audit_labels(lower(label)) WHERE label IS NOT NULL",
  },
  {
    context: "WHERE inside an expression string",
    name: "audit_literal",
    definition:
      "CREATE INDEX audit_literal ON audit_labels(instr(label, 'WHERE marker')) WHERE label IS NOT NULL",
  },
  {
    context: "WHERE inside a quoted index name",
    name: "audit WHERE marker",
    definition:
      'CREATE INDEX "audit WHERE marker" ON audit_labels(lower(label)) WHERE label IS NOT NULL',
  },
  {
    context: "WHERE inside a comment",
    name: "audit_comment",
    definition:
      "CREATE INDEX audit_comment ON audit_labels(lower(label)) /* WHERE marker */ WHERE label IS NOT NULL",
  },
])("recovers the partial index predicate with $context", async ({ name, definition }) => {
  const catalog = await readCatalog(indexCatalog(name, definition), { namespace: "main" })

  expect(catalog.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([])
  expect(catalog.tables[0]?.indexes).toHaveLength(1)
  expect(catalog.tables[0]?.indexes[0]?.predicate?.text).toBe("label IS NOT NULL")
})
