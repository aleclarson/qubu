import { DatabaseSync, type SQLInputValue } from "node:sqlite"

import { expect, test } from "vitest"

import { mapCatalogToCompleteSnapshot, mapCatalogToSnapshot } from "../src/introspection/index.ts"
import type {
  CatalogConnection,
  CatalogQuery,
  IntrospectionOptions,
} from "../src/introspection/index.ts"
import {
  sqliteDatabaseListQuery,
  sqliteForeignKeyQuery,
  sqliteIndexInfoQuery,
  sqliteIndexListQuery,
  sqliteSchemaQuery,
  sqliteServerQuery,
  sqliteTableInfoQuery,
  sqliteTableListQuery,
  readCatalog,
} from "../src/introspection/sqlite.ts"

type Row = Readonly<Record<string, unknown>>

function databaseConnection(database: DatabaseSync): CatalogConnection {
  return {
    dialect: "sqlite",
    async query<TRow extends Row = Row>(statement: CatalogQuery) {
      return database
        .prepare(statement.text)
        .all(...(statement.parameters as SQLInputValue[])) as unknown as readonly TRow[]
    },
  }
}

function options(namespace = "main"): IntrospectionOptions {
  return { namespace }
}

function connection(
  rows: (statement: CatalogQuery) => readonly Row[],
  dialect: CatalogConnection["dialect"] = "sqlite",
) {
  const calls: CatalogQuery[] = []
  const value: CatalogConnection = {
    dialect,
    async query<TRow extends Row = Row>(statement: CatalogQuery) {
      calls.push(statement)
      return rows(statement) as readonly TRow[]
    },
  }

  return {
    connection: value,
    calls,
  }
}

function completeConnection() {
  return connection((statement) => {
    if (statement.text === sqliteServerQuery) {
      return [
        {
          version: "3.45.1",
          source_id: "2024-test-build",
        },
      ]
    }

    if (statement.text === sqliteDatabaseListQuery) {
      return [
        {
          seq: 0,
          name: "main",
          file: "",
        },
        {
          seq: 1,
          name: "archive",
          file: "/tmp/archive.sqlite",
        },
      ]
    }

    if (statement.text === sqliteSchemaQuery) {
      return [
        {
          type: "table",
          name: "child",
          tbl_name: "child",
          sql: "CREATE TABLE child (parent_a INTEGER, parent_b INTEGER, doubled INTEGER GENERATED ALWAYS AS (parent_a + parent_b) STORED, hidden_col TEXT HIDDEN, PRIMARY KEY (parent_a, parent_b), FOREIGN KEY (parent_a, parent_b) REFERENCES parent(a, b) ON UPDATE CASCADE ON DELETE SET NULL) WITHOUT ROWID, STRICT",
        },
        {
          type: "table",
          name: "parent",
          tbl_name: "parent",
          sql: "CREATE TABLE parent (id INTEGER PRIMARY KEY AUTOINCREMENT, a TEXT, b TEXT, amount DECIMAL, lower_a TEXT GENERATED ALWAYS AS (lower(a)) VIRTUAL, upper_b TEXT GENERATED ALWAYS AS (upper(b)) STORED, UNIQUE (a, b))",
        },
        {
          type: "table",
          name: "search",
          tbl_name: "search",
          sql: "CREATE VIRTUAL TABLE search USING fts5(content)",
        },
        {
          type: "table",
          name: "search_content",
          tbl_name: "search_content",
          sql: "CREATE TABLE 'search_content'(id INTEGER PRIMARY KEY, c0)",
        },
        {
          type: "index",
          name: "child_live_idx",
          tbl_name: "child",
          sql: "CREATE INDEX child_live_idx ON child(parent_b DESC) WHERE parent_b > 0",
        },
        {
          type: "view",
          name: "child_view",
          tbl_name: "child_view",
          sql: "CREATE VIEW child_view AS SELECT * FROM child",
        },
        {
          type: "trigger",
          name: "child_trigger",
          tbl_name: "child",
          sql: "CREATE TRIGGER child_trigger AFTER INSERT ON child BEGIN SELECT 1; END",
        },
      ]
    }

    if (statement.text === sqliteTableListQuery) {
      return [
        {
          schema: "main",
          name: "child",
          type: "table",
          wr: 1,
          strict: 1,
        },
        {
          schema: "main",
          name: "parent",
          type: "table",
          wr: 0,
          strict: 0,
        },
        {
          schema: "main",
          name: "child_view",
          type: "view",
          wr: 0,
          strict: 0,
        },
        {
          schema: "main",
          name: "search",
          type: "virtual",
          wr: 0,
          strict: 0,
        },
        {
          schema: "main",
          name: "search_content",
          type: "shadow",
          wr: 0,
          strict: 0,
        },
      ]
    }

    if (statement.text === sqliteTableInfoQuery && statement.parameters[0] === "parent") {
      return [
        {
          cid: 0,
          name: "id",
          type: "INTEGER",
          not_null: 0,
          dflt_value: null,
          pk: 1,
          hidden: 0,
        },
        {
          cid: 1,
          name: "a",
          type: "TEXT",
          not_null: 0,
          dflt_value: "'a'",
          pk: 0,
          hidden: 0,
        },
        {
          cid: 2,
          name: "b",
          type: "TEXT",
          not_null: 0,
          dflt_value: null,
          pk: 0,
          hidden: 0,
        },
        {
          cid: 3,
          name: "amount",
          type: "DECIMAL",
          not_null: 0,
          dflt_value: null,
          pk: 0,
          hidden: 0,
        },
        {
          cid: 4,
          name: "lower_a",
          type: "TEXT",
          not_null: 0,
          dflt_value: null,
          pk: 0,
          hidden: 2,
        },
        {
          cid: 5,
          name: "upper_b",
          type: "TEXT",
          not_null: 0,
          dflt_value: null,
          pk: 0,
          hidden: 3,
        },
      ]
    }

    if (statement.text === sqliteTableInfoQuery && statement.parameters[0] === "child_view") {
      return [
        {
          cid: 0,
          name: "parent_a",
          type: "INTEGER",
          not_null: 0,
          dflt_value: null,
          pk: 0,
          hidden: 0,
        },
        {
          cid: 1,
          name: "parent_b",
          type: "INTEGER",
          not_null: 0,
          dflt_value: null,
          pk: 0,
          hidden: 0,
        },
      ]
    }

    if (statement.text === sqliteTableInfoQuery) {
      return [
        {
          cid: 0,
          name: "parent_a",
          type: "INTEGER",
          not_null: 1,
          dflt_value: null,
          pk: 1,
          hidden: 0,
        },
        {
          cid: 1,
          name: "parent_b",
          type: "INTEGER",
          not_null: 1,
          dflt_value: null,
          pk: 2,
          hidden: 0,
        },
        {
          cid: 2,
          name: "doubled",
          type: "INTEGER",
          not_null: 0,
          dflt_value: null,
          pk: 0,
          hidden: 3,
        },
        {
          cid: 3,
          name: "hidden_col",
          type: "TEXT",
          not_null: 0,
          dflt_value: null,
          pk: 0,
          hidden: 1,
        },
      ]
    }

    if (statement.text === sqliteIndexListQuery && statement.parameters[0] === "child") {
      return [
        {
          seq: 0,
          name: "child_live_idx",
          unique_index: 0,
          origin: "c",
          partial: 1,
        },
        {
          seq: 1,
          name: "sqlite_autoindex_child_1",
          unique_index: 1,
          origin: "u",
          partial: 0,
        },
      ]
    }

    if (statement.text === sqliteIndexListQuery && statement.parameters[0] === "parent") {
      return [
        {
          seq: 0,
          name: "sqlite_autoindex_parent_1",
          unique_index: 1,
          origin: "u",
          partial: 0,
        },
      ]
    }

    if (
      statement.text === sqliteIndexInfoQuery &&
      statement.parameters[0] === "sqlite_autoindex_parent_1"
    ) {
      return [
        {
          seqno: 0,
          cid: 1,
          name: "a",
          descending: 0,
          coll: "BINARY",
          key: 1,
        },
        {
          seqno: 1,
          cid: 2,
          name: "b",
          descending: 0,
          coll: "BINARY",
          key: 1,
        },
      ]
    }

    if (statement.text === sqliteIndexInfoQuery) {
      return [
        {
          seqno: 0,
          cid: 1,
          name: "parent_b",
          descending: 1,
          coll: "BINARY",
          key: 1,
        },
      ]
    }

    if (statement.text === sqliteForeignKeyQuery && statement.parameters[0] === "child") {
      return [
        {
          id: 0,
          seq: 1,
          target_table: "parent",
          source_column: "parent_b",
          target_column: "b",
          on_update: "CASCADE",
          on_delete: "SET NULL",
          match: "NONE",
        },
        {
          id: 0,
          seq: 0,
          target_table: "parent",
          source_column: "parent_a",
          target_column: "a",
          on_update: "CASCADE",
          on_delete: "SET NULL",
          match: "NONE",
        },
      ]
    }

    return []
  })
}

test("normalizes SQLite versions, complete families, generated columns, and boundaries", async () => {
  const fake = completeConnection()
  const catalog = await readCatalog(fake.connection, options())
  const child = catalog.tables.find((table) => table.physicalName === "child")!
  const parent = catalog.tables.find((table) => table.physicalName === "parent")!

  expect(catalog.server).toMatchObject({
    product: "sqlite",
    rawVersion: "3.45.1",
    parsedVersion: {
      major: 3,
      minor: 45,
      patch: 1,
    },
    capabilities: {
      generatedColumns: true,
      indexPredicates: true,
      sourceIdAvailable: true,
    },
  })
  expect(catalog.server.capabilities).toMatchObject({
    views: true,
    triggers: true,
    virtualTables: true,
    shadowTables: true,
    affinityFacts: true,
  })
  expect(catalog.namespace.dialect).toMatchObject({
    data: {
      selectedNamespace: "main",
      sourceIdAvailable: true,
      attachedDatabases: ["archive"],
    },
  })
  expect(child.unknownFields).toEqual(
    expect.arrayContaining([
      {
        name: "withoutRowid",
        value: true,
      },
      {
        name: "strict",
        value: true,
      },
    ]),
  )
  expect(child.columns.map((column) => column.physicalName)).toEqual([
    "parent_a",
    "parent_b",
    "doubled",
  ])
  expect(child.columns[2]).toMatchObject({
    generated: {
      mode: "stored",
      expression: { text: "parent_a + parent_b" },
    },
  })
  expect(child.columns.some((column) => column.physicalName === "hidden_col")).toBe(false)
  expect(parent.columns[0]).toMatchObject({
    identity: {
      generation: "by-default",
      dialect: { data: { autoIncrement: true } },
    },
    nullable: false,
  })
  expect(parent.columns).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        physicalName: "amount",
        dialect: expect.objectContaining({
          data: expect.objectContaining({ affinity: "NUMERIC" }),
        }),
      }),
      expect.objectContaining({
        physicalName: "lower_a",
        generated: expect.objectContaining({
          mode: "virtual",
          expression: expect.objectContaining({ text: "lower(a)" }),
        }),
      }),
      expect.objectContaining({
        physicalName: "upper_b",
        generated: expect.objectContaining({
          mode: "stored",
          expression: expect.objectContaining({ text: "upper(b)" }),
        }),
      }),
    ]),
  )
  expect(child.columns.every((column) => !column.identity)).toBe(true)
  expect(catalog.views).toEqual([
    expect.objectContaining({
      kind: "view",
      physicalName: "child_view",
      definition: expect.objectContaining({ text: "SELECT * FROM child" }),
    }),
  ])
  expect(catalog.triggers).toEqual([
    expect.objectContaining({
      kind: "trigger",
      physicalName: "child_trigger",
      table: {
        kind: "table",
        id: "child",
      },
    }),
  ])
  expect(catalog.deferredObjects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectKind: "virtual-table",
        physicalName: "search",
      }),
      expect.objectContaining({
        objectKind: "shadow-table",
        physicalName: "search_content",
      }),
    ]),
  )
  expect(catalog.opaqueObjects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectKind: "attached-database",
        physicalName: "archive",
        data: expect.objectContaining({ selected: false }),
      }),
    ]),
  )
})

test("normalizes primary keys, user indexes, partial predicates, and grouped foreign keys", async () => {
  const catalog = await readCatalog(completeConnection().connection, options())
  const child = catalog.tables.find((table) => table.physicalName === "child")!

  expect(child.constraints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "primary-key",
        columns: ["parent_a", "parent_b"],
      }),
      expect.objectContaining({
        kind: "foreign-key",
        columns: ["parent_a", "parent_b"],
        target: {
          table: "parent",
          columns: ["a", "b"],
        },
        onUpdate: "cascade",
        onDelete: "set-null",
        match: "simple",
      }),
    ]),
  )
  const parent = catalog.tables.find((table) => table.physicalName === "parent")!

  expect(parent.constraints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "unique",
        physicalName: "unique_parent_a_b",
        identitySource: "deterministic-fallback",
        columns: ["a", "b"],
      }),
    ]),
  )
  expect(
    child.constraints.some((constraint) =>
      constraint.physicalName?.startsWith("sqlite_autoindex_"),
    ),
  ).toBe(false)
  expect(child.indexes).toEqual([
    expect.objectContaining({
      physicalName: "child_live_idx",
      terms: [
        {
          kind: "column",
          column: "parent_b",
          position: 0,
          direction: "DESC",
        },
      ],
      predicate: expect.objectContaining({ text: "parent_b > 0" }),
    }),
  ])
})

test("maps complete SQLite objects through the Snapshot v1 table surface", async () => {
  const catalog = await readCatalog(completeConnection().connection, options())
  const complete = mapCatalogToCompleteSnapshot(catalog)

  expect(complete.ok).toBe(true)
  if (complete.ok) {
    expect(complete.snapshot.tables.map((table) => table.id)).toEqual(["child", "parent"])
    expect(complete.snapshot.views.map((view) => view.id)).toEqual(["child_view"])
    expect(complete.snapshot.triggers.map((trigger) => trigger.id)).toEqual(["child_trigger"])
    expect(complete.snapshot.deferredObjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objectKind: "virtual-table" }),
        expect.objectContaining({ objectKind: "shadow-table" }),
      ]),
    )
    expect(complete.snapshot.opaqueObjects).toEqual(
      expect.arrayContaining([expect.objectContaining({ objectKind: "attached-database" })]),
    )
  }

  const snapshot = mapCatalogToSnapshot(catalog, options())

  expect(snapshot.ok).toBe(true)
  if (snapshot.ok) {
    expect(snapshot.snapshot.tables.map((table) => table.physicalName)).toEqual(["child", "parent"])
  }
})

test("resolves implicit SQLite foreign keys and nested checks", async () => {
  const fake = connection((statement) => {
    if (statement.text === sqliteServerQuery) {
      return [{ version: "3.45.1" }]
    }

    if (statement.text === sqliteDatabaseListQuery) {
      return [
        {
          seq: 0,
          name: "main",
          file: "",
        },
      ]
    }

    if (statement.text === sqliteSchemaQuery) {
      return [
        {
          type: "table",
          name: "child",
          tbl_name: "child",
          sql: "CREATE TABLE child (source_a INTEGER, source_b INTEGER, CONSTRAINT child_check CHECK (coalesce(length(trim(source_a)), 0) > 0), FOREIGN KEY (source_a, source_b) REFERENCES parent)",
        },
        {
          type: "table",
          name: "parent",
          tbl_name: "parent",
          sql: "CREATE TABLE parent (parent_a INTEGER, parent_b INTEGER, PRIMARY KEY (parent_a, parent_b))",
        },
      ]
    }

    if (statement.text === sqliteTableListQuery) {
      return [
        {
          schema: "main",
          name: "child",
          type: "table",
        },
        {
          schema: "main",
          name: "parent",
          type: "table",
        },
      ]
    }

    if (statement.text === sqliteTableInfoQuery && statement.parameters[0] === "parent") {
      return [
        {
          cid: 0,
          name: "parent_a",
          type: "INTEGER",
          not_null: 1,
          pk: 1,
          hidden: 0,
        },
        {
          cid: 1,
          name: "parent_b",
          type: "INTEGER",
          not_null: 1,
          pk: 2,
          hidden: 0,
        },
      ]
    }

    if (statement.text === sqliteTableInfoQuery && statement.parameters[0] === "child") {
      return [
        {
          cid: 0,
          name: "source_a",
          type: "INTEGER",
          not_null: 0,
          pk: 0,
          hidden: 0,
        },
        {
          cid: 1,
          name: "source_b",
          type: "INTEGER",
          not_null: 0,
          pk: 0,
          hidden: 0,
        },
      ]
    }

    if (statement.text === sqliteForeignKeyQuery && statement.parameters[0] === "child") {
      return [
        {
          id: 0,
          seq: 1,
          target_table: "parent",
          source_column: "source_b",
          target_column: null,
          on_update: "NO ACTION",
          on_delete: "NO ACTION",
          match: "NONE",
        },
        {
          id: 0,
          seq: 0,
          target_table: "parent",
          source_column: "source_a",
          target_column: null,
          on_update: "NO ACTION",
          on_delete: "NO ACTION",
          match: "NONE",
        },
      ]
    }

    return []
  })
  const catalog = await readCatalog(fake.connection, options())
  const child = catalog.tables.find((table) => table.physicalName === "child")!

  expect(child.constraints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "check",
        expression: expect.objectContaining({
          text: "coalesce(length(trim(source_a)), 0) > 0",
        }),
      }),
      expect.objectContaining({
        kind: "foreign-key",
        columns: ["source_a", "source_b"],
        target: {
          table: "parent",
          columns: ["parent_a", "parent_b"],
        },
      }),
    ]),
  )
  expect(JSON.stringify(catalog)).not.toContain('"unknown"')
})

test("retains SQLite foreign keys without recoverable target columns as opaque data", async () => {
  const fake = connection((statement) => {
    if (statement.text === sqliteServerQuery) {
      return [{ version: "3.45.1" }]
    }

    if (statement.text === sqliteSchemaQuery) {
      return [
        {
          type: "table",
          name: "child",
          tbl_name: "child",
          sql: "CREATE TABLE child (source_id INTEGER, FOREIGN KEY (source_id) REFERENCES target)",
        },
        {
          type: "table",
          name: "target",
          tbl_name: "target",
          sql: "CREATE TABLE target (id INTEGER)",
        },
      ]
    }

    if (statement.text === sqliteTableListQuery) {
      return [
        {
          schema: "main",
          name: "child",
          type: "table",
        },
        {
          schema: "main",
          name: "target",
          type: "table",
        },
      ]
    }

    if (statement.text === sqliteTableInfoQuery) {
      return [
        {
          cid: 0,
          name: statement.parameters[0] === "child" ? "source_id" : "id",
          type: "INTEGER",
          not_null: 0,
          pk: 0,
          hidden: 0,
        },
      ]
    }

    if (statement.text === sqliteForeignKeyQuery && statement.parameters[0] === "child") {
      return [
        {
          id: 0,
          seq: 0,
          target_table: "target",
          source_column: "source_id",
          target_column: null,
          on_update: "NO ACTION",
          on_delete: "NO ACTION",
          match: "NONE",
        },
      ]
    }

    return []
  })
  const catalog = await readCatalog(fake.connection, options())
  const child = catalog.tables.find((table) => table.physicalName === "child")!

  expect(child.constraints).toEqual([])
  expect(catalog.opaqueObjects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectKind: "foreign-key",
        data: expect.objectContaining({
          targetTable: "target",
          sourceColumns: ["source_id"],
          targetColumns: [null],
        }),
      }),
    ]),
  )
  expect(catalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "unresolved-reference",
        severity: "error",
      }),
    ]),
  )
})

test("verifies SQLite catalog SQL against an in-memory database", async () => {
  const database = new DatabaseSync(":memory:")

  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE parent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        generated_virtual TEXT GENERATED ALWAYS AS (lower(name)) VIRTUAL,
        generated_stored TEXT GENERATED ALWAYS AS (upper(name)) STORED
      ) STRICT;
      CREATE TABLE child (
        parent_id INTEGER REFERENCES parent(id),
        name TEXT,
        CONSTRAINT child_name_check CHECK (coalesce(length(trim(name)), 0) > 0)
      );
      CREATE TABLE implicit_parent (
        first_key TEXT NOT NULL,
        second_key TEXT NOT NULL,
        PRIMARY KEY (first_key, second_key)
      );
      CREATE TABLE implicit_child (
        first_key TEXT,
        second_key TEXT,
        CONSTRAINT implicit_child_check CHECK (coalesce(length(trim(first_key)), 0) > 0),
        FOREIGN KEY (first_key, second_key) REFERENCES implicit_parent
      );
      CREATE UNIQUE INDEX child_name_idx
        ON child (lower(name))
        WHERE name IS NOT NULL;
      CREATE VIEW child_view AS SELECT parent_id, name FROM child;
      CREATE TRIGGER child_trigger
        AFTER INSERT ON child
        WHEN new.name <> ''
        BEGIN
          UPDATE parent SET name = new.name WHERE id = new.parent_id;
        END;
      CREATE VIRTUAL TABLE search USING fts5(content);
      ATTACH DATABASE ':memory:' AS archive;
      CREATE TABLE archive.events(id INTEGER PRIMARY KEY);
    `)

    const catalog = await readCatalog(databaseConnection(database), {
      namespace: "main",
    })
    const parent = catalog.tables.find((table) => table.physicalName === "parent")!
    const child = catalog.tables.find((table) => table.physicalName === "child")!
    const implicitChild = catalog.tables.find((table) => table.physicalName === "implicit_child")!

    expect(parent.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          physicalName: "generated_virtual",
          generated: expect.objectContaining({
            mode: "virtual",
            expression: expect.objectContaining({ text: "lower(name)" }),
          }),
        }),
        expect.objectContaining({
          physicalName: "generated_stored",
          generated: expect.objectContaining({
            mode: "stored",
            expression: expect.objectContaining({ text: "upper(name)" }),
          }),
        }),
      ]),
    )
    expect(parent.columns[0]).toMatchObject({
      identity: { dialect: { data: { rowidAlias: true } } },
      nullable: false,
    })
    expect(child.indexes[0]).toMatchObject({
      physicalName: "child_name_idx",
      terms: [
        expect.objectContaining({
          kind: "expression",
          expression: expect.objectContaining({ text: "lower(name)" }),
        }),
      ],
      predicate: expect.objectContaining({ text: "name IS NOT NULL" }),
    })
    expect(child.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "check",
          expression: expect.objectContaining({
            text: "coalesce(length(trim(name)), 0) > 0",
          }),
        }),
      ]),
    )
    expect(implicitChild.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "check",
          expression: expect.objectContaining({
            text: "coalesce(length(trim(first_key)), 0) > 0",
          }),
        }),
        expect.objectContaining({
          kind: "foreign-key",
          target: {
            table: "implicit_parent",
            columns: ["first_key", "second_key"],
          },
        }),
      ]),
    )
    expect(catalog.views?.[0]).toMatchObject({
      kind: "view",
      physicalName: "child_view",
    })
    expect(catalog.triggers?.[0]).toMatchObject({
      kind: "trigger",
      physicalName: "child_trigger",
      condition: { text: "new.name <> ''" },
    })
    expect(catalog.deferredObjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectKind: "virtual-table",
          physicalName: "search",
        }),
      ]),
    )
    expect(catalog.opaqueObjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectKind: "attached-database",
          physicalName: "archive",
        }),
      ]),
    )
    expect(catalog.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error" })]),
    )
  } finally {
    database.close()
  }
})

test("defers unrecoverable SQLite definitions with diagnostics", async () => {
  const fake = connection((statement) => {
    if (statement.text === sqliteServerQuery) {
      return [{ version: "3.45.1" }]
    }

    if (statement.text === sqliteTableListQuery) {
      return [
        {
          schema: "main",
          name: "broken_view",
          type: "view",
        },
      ]
    }

    if (statement.text === sqliteSchemaQuery) {
      return [
        {
          type: "view",
          name: "broken_view",
          tbl_name: "broken_view",
        },
      ]
    }

    return []
  })
  const catalog = await readCatalog(fake.connection, options())

  expect(catalog.views).toEqual([])
  expect(catalog.deferredObjects).toEqual([
    expect.objectContaining({
      objectKind: "view",
      physicalName: "broken_view",
    }),
  ])
  expect(catalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "expression-parse-failed",
        path: ["views", "broken_view", "definition"],
      }),
    ]),
  )
})

test("reports unsupported versions, dialect mismatches, and query diagnostics", async () => {
  const old = connection((statement) =>
    statement.text === sqliteServerQuery ? [{ version: "3.36.0" }] : [],
  )
  const oldCatalog = await readCatalog(old.connection, options())

  expect(oldCatalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "unsupported-server",
        severity: "error",
      }),
    ]),
  )

  const mismatch = connection(() => [], "postgresql")
  const mismatchCatalog = await readCatalog(mismatch.connection, options())

  expect(mismatch.calls).toHaveLength(0)
  expect(mismatchCatalog.diagnostics).toEqual([
    expect.objectContaining({
      code: "dialect-mismatch",
      severity: "error",
    }),
  ])

  const failing = connection((statement) => {
    if (statement.text === sqliteServerQuery) {
      return [{ version: "3.45.0" }]
    }

    if (statement.text === sqliteTableListQuery) {
      throw new Error("password=secret")
    }

    return []
  })
  const failingCatalog = await readCatalog(failing.connection, options("private"))

  expect(failingCatalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "query-failed",
        path: ["table-list"],
      }),
    ]),
  )
  expect(JSON.stringify(failingCatalog.diagnostics)).not.toContain("secret")
})
