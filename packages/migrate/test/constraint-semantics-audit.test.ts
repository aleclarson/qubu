import { foreignKey, integer, primaryKey, references, schema, table, uniqueConstraint } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

function emitCreation(after: SchemaSnapshot) {
  const before: SchemaSnapshot = {
    ...after,
    tables: [],
  }
  const planned = createMigrationPlan(diffSnapshots(before, after))

  expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
  const emitted = emitMigrationPlan(planned.plan, {
    serverVersion: "17.0",
    afterSnapshot: after,
  })

  expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
  return emitted.sql
}

test.each(["distinct", "not-distinct"] as const)(
  "preserves PostgreSQL unique constraint NULL semantics: %s",
  (nulls) => {
    const records = table("records", { key: integer({ nullable: true }) }, (columns) => ({
      constraints: { keyUnique: uniqueConstraint(columns.key, { nulls }) },
      indexes: {},
    }))
    // Retain version-dependent metadata; emitCreation supplies the PostgreSQL 17 policy.
    const neutral = createSchemaSnapshot(schema({ records }, { namespace: "public" }))
    const after: SchemaSnapshot = {
      ...neutral,
      dialect: {
        name: "postgresql",
        version: 1,
      },
      namespace: {
        kind: "postgres-schema",
        name: "public",
      },
    }
    const sql = emitCreation(after)

    expect(sql).toContain(
      nulls === "not-distinct" ? 'UNIQUE NULLS NOT DISTINCT ("key")' : 'UNIQUE ("key")',
    )
  },
)

function foreignKeySnapshot(match: "simple" | "full") {
  const parent = table(
    "parent",
    {
      first: integer(),
      second: integer(),
    },
    (columns) => ({
      constraints: { primary: primaryKey(columns.first, columns.second) },
      indexes: {},
    }),
  )
  const child = table(
    "child",
    {
      first: integer({ nullable: true }),
      second: integer({ nullable: true }),
    },
    (columns) => ({
      constraints: {
        parentKey: foreignKey(
          [columns.first, columns.second],
          references(parent, parent.first, parent.second),
          { match },
        ),
      },
      indexes: {},
    }),
  )

  return createSchemaSnapshot(
    schema(
      {
        parent,
        child,
      },
      { namespace: "public" },
    ),
    {
      dialect: postgresSchemaDialect,
    },
  )
}

test.each(["simple", "full"] as const)(
  "preserves PostgreSQL composite foreign key match semantics: %s",
  (match) => {
    const after = foreignKeySnapshot(match)
    const sql = emitCreation(after)

    if (match === "full") {
      expect(sql).toContain('REFERENCES "public"."parent" ("first", "second") MATCH FULL')
    } else {
      expect(sql).toContain('REFERENCES "public"."parent" ("first", "second")')
      expect(sql).not.toContain("MATCH FULL")
    }
  },
)

test("creates the referenced primary key before adding its foreign key", () => {
  const after = foreignKeySnapshot("simple")
  const sql = emitCreation(after)
  const primary = sql.indexOf('PRIMARY KEY ("first", "second")')
  const foreign = sql.indexOf('FOREIGN KEY ("first", "second")')

  expect(primary).toBeGreaterThanOrEqual(0)
  expect(foreign).toBeGreaterThanOrEqual(0)
  expect(primary).toBeLessThan(foreign)
})
