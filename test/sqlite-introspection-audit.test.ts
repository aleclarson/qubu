import { expect, test } from "vitest"

import type {
  CatalogConnection,
  CatalogQuery,
  CatalogQueryRow,
} from "../src/introspection/index.ts"
import {
  readCatalog,
  sqliteDatabaseListQuery,
  sqliteIndexListQuery,
  sqliteSchemaQuery,
  sqliteServerQuery,
  sqliteTableInfoQuery,
  sqliteTableListQuery,
} from "../src/introspection/sqlite.ts"

// These rows describe ordinary rowid tables, including the SQLite exception for
// an inline INTEGER PRIMARY KEY DESC. Table flags come from pragma_table_list.
function catalogConnection(sql: string, type = "INTEGER"): CatalogConnection {
  return {
    dialect: "sqlite",
    async query<TRow extends CatalogQueryRow = CatalogQueryRow>(statement: CatalogQuery) {
      let rows: readonly CatalogQueryRow[] = []

      if (statement.text === sqliteServerQuery) {
        rows = [
          {
            version: "3.45.1",
            source_id: "audit",
          },
        ]
      } else if (statement.text === sqliteDatabaseListQuery) {
        rows = [
          {
            seq: 0,
            name: "main",
            file: "",
          },
        ]
      } else if (statement.text === sqliteSchemaQuery) {
        rows = [
          {
            type: "table",
            name: "audit_keys",
            tbl_name: "audit_keys",
            sql,
          },
        ]
      } else if (statement.text === sqliteTableListQuery) {
        rows = [
          {
            schema: "main",
            name: "audit_keys",
            type: "table",
            ncol: 1,
            wr: 0,
            strict: 0,
          },
        ]
      } else if (statement.text === sqliteTableInfoQuery) {
        rows = [
          {
            cid: 0,
            name: "id",
            type,
            not_null: 0,
            dflt_value: null,
            pk: 1,
            hidden: 0,
          },
        ]
      } else if (
        statement.text === sqliteIndexListQuery &&
        (type === "TEXT" || sql.includes("DESC"))
      ) {
        rows = [
          {
            seq: 0,
            name: "sqlite_autoindex_audit_keys_1",
            unique_index: 1,
            origin: "pk",
            partial: 0,
          },
        ]
      }

      return rows as readonly TRow[]
    },
  }
}

test("keeps inline INTEGER PRIMARY KEY DESC nullable and separate from the rowid", async () => {
  const catalog = await readCatalog(
    catalogConnection("CREATE TABLE audit_keys (id INTEGER PRIMARY KEY DESC)"),
    { namespace: "main" },
  )

  expect(catalog.tables[0]?.columns[0]).toMatchObject({ nullable: true })
  expect(catalog.tables[0]?.columns[0]?.identity).toBeUndefined()
})

test("ignores WITHOUT ROWID inside a default string when identifying a rowid alias", async () => {
  const catalog = await readCatalog(
    catalogConnection("CREATE TABLE audit_keys (id INTEGER PRIMARY KEY DEFAULT 'WITHOUT ROWID')"),
    { namespace: "main" },
  )

  expect(catalog.tables[0]?.columns[0]).toMatchObject({
    nullable: false,
    identity: {
      dialect: {
        data: {
          rowidAlias: true,
          withoutRowid: false,
        },
      },
    },
  })
})

test("ignores STRICT inside a default string when deriving primary key nullability", async () => {
  const catalog = await readCatalog(
    catalogConnection("CREATE TABLE audit_keys (id TEXT PRIMARY KEY DEFAULT 'STRICT')", "TEXT"),
    { namespace: "main" },
  )

  expect(catalog.tables[0]?.columns[0]).toMatchObject({ nullable: true })
})

test("ignores AUTOINCREMENT inside a default string when deriving identity options", async () => {
  const catalog = await readCatalog(
    catalogConnection("CREATE TABLE audit_keys (id INTEGER PRIMARY KEY DEFAULT 'AUTOINCREMENT')"),
    { namespace: "main" },
  )

  expect(catalog.tables[0]?.columns[0]?.identity).toMatchObject({
    dialect: {
      data: {
        rowidAlias: true,
        autoIncrement: false,
      },
    },
  })
})

test("recognizes an ordinary INTEGER PRIMARY KEY as a non-null rowid alias", async () => {
  const catalog = await readCatalog(
    catalogConnection("CREATE TABLE audit_keys (id INTEGER PRIMARY KEY)"),
    { namespace: "main" },
  )

  expect(catalog.tables[0]?.columns[0]).toMatchObject({
    nullable: false,
    identity: {
      dialect: {
        data: {
          rowidAlias: true,
          autoIncrement: false,
        },
      },
    },
  })
})
