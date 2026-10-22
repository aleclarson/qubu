import { index, lower, schema, table, text } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { sqliteSchemaDialect } from "qubu/snapshot/sqlite"
import { expect, test } from "vitest"

import * as postgresDdl from "../src/ddl/postgres.ts"
import * as sqliteDdl from "../src/ddl/sqlite.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

function indexPlan(after: SchemaSnapshot) {
  const before: SchemaSnapshot = {
    ...after,
    tables: after.tables.map((entry) => ({
      ...entry,
      indexes: [],
    })),
  }
  const planned = createMigrationPlan(diffSnapshots(before, after))

  expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
  return planned.plan
}

test("qualifies the PostgreSQL table without qualifying the new index name", () => {
  const records = table("records", { label: text() }, (columns) => ({
    constraints: {},
    indexes: { label_lookup: index([columns.label]) },
  }))
  const after = createSchemaSnapshot(schema({ records }, { namespace: "public" }), {
    dialect: postgresSchemaDialect,
  })
  const emitted = postgresDdl.emitMigrationPlan(indexPlan(after), { afterSnapshot: after })

  expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
  expect(emitted.sql).toBe('CREATE INDEX "label_lookup" ON "public"."records" ("label");')
})

test.each([
  {
    expression: false,
    operatorClass: undefined,
  },
  {
    expression: false,
    operatorClass: "text_pattern_ops",
  },
  {
    expression: true,
    operatorClass: undefined,
  },
  {
    expression: true,
    operatorClass: "text_pattern_ops",
  },
])(
  "preserves PostgreSQL index operator classes (expression: $expression, class: $operatorClass)",
  ({ expression, operatorClass }) => {
    const records = table("records", { label: text() }, (columns) => ({
      constraints: {},
      indexes: {
        label_lookup: index(
          [expression ? lower(columns.label) : columns.label],
          operatorClass === undefined ? {} : { termOptions: [{ operatorClass }] },
        ),
      },
    }))
    const after = createSchemaSnapshot(schema({ records }, { namespace: "public" }), {
      dialect: postgresSchemaDialect,
    })

    if (operatorClass !== undefined) {
      expect(after.tables[0]?.indexes[0]?.terms[0]?.operatorClass).toBe(operatorClass)
    }

    const emitted = postgresDdl.emitMigrationPlan(indexPlan(after), { afterSnapshot: after })

    expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
    const term = expression ? '(LOWER("label"))' : '"label"'

    if (operatorClass === undefined) {
      expect(emitted.sql).toContain(`(${term})`)
    } else {
      // Quoting a built-in operator class is optional; retaining it is required.
      expect(emitted.sql).toMatch(
        new RegExp(`${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} "?text_pattern_ops"?`),
      )
    }
  },
)

test.each(["BINARY", "NOCASE"] as const)(
  "preserves SQLite unique index collation %s",
  (collation) => {
    const records = table("records", { label: text() }, (columns) => ({
      constraints: {},
      indexes: { label_unique: index([columns.label], { unique: true }) },
    }))
    const base = createSchemaSnapshot(schema({ records }, { namespace: "main" }), {
      dialect: sqliteSchemaDialect,
    })
    const after: SchemaSnapshot = {
      ...base,
      tables: base.tables.map((entry) => ({
        ...entry,
        indexes: entry.indexes.map((value) => ({
          ...value,
          // This is the extension emitted by SQLite catalog-to-snapshot mapping.
          dialect: {
            dialect: "sqlite",
            version: 1,
            data: {
              origin: "c",
              partial: false,
              collations: [collation],
            },
          },
        })),
      })),
    }
    const emitted = sqliteDdl.emitMigrationPlan(indexPlan(after), { afterSnapshot: after })

    expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)

    if (collation === "NOCASE") {
      expect(emitted.sql).toMatch(/"label" COLLATE "?NOCASE"?/i)
    } else {
      expect(emitted.sql).toContain('("label")')
    }
  },
)
