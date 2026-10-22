import { integer, schema, table, text } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

test.each([
  {
    kind: "domain",
    consumer: "table",
  },
  {
    kind: "domain",
    consumer: "column",
  },
  {
    kind: "enum",
    consumer: "table",
  },
  {
    kind: "enum",
    consumer: "column",
  },
] as const)("creates a PostgreSQL $kind before its dependent $consumer", ({ kind, consumer }) => {
  const accounts = table("accounts", { balance: kind === "domain" ? integer() : text() })
  const base = createSchemaSnapshot(schema({ accounts }, { namespace: "public" }), {
    dialect: postgresSchemaDialect,
  })
  const after: SchemaSnapshot = {
    ...base,
    domains:
      kind === "domain"
        ? [
            {
              kind: "domain",
              id: "positive_balance",
              physicalName: "positive_balance",
              storage: {
                kind: "native",
                dialect: "postgresql",
                type: "integer",
              },
              nullable: false,
            },
          ]
        : [],
    enums:
      kind === "enum"
        ? [
            {
              kind: "enum",
              id: "positive_balance",
              physicalName: "positive_balance",
              values: [
                {
                  value: "positive",
                  ordinalPosition: 1,
                },
                {
                  value: "negative",
                  ordinalPosition: 2,
                },
              ],
            },
          ]
        : [],
    tables: base.tables.map((entry) => ({
      ...entry,
      columns: entry.columns.map((column) => ({
        ...column,
        storage: {
          kind: "native",
          dialect: "postgresql",
          type: "public.positive_balance",
        },
      })),
    })),
  }
  const before: SchemaSnapshot = {
    ...base,
    tables:
      consumer === "table"
        ? []
        : base.tables.map((entry) => ({
            ...entry,
            columns: [],
          })),
  }
  const planned = createMigrationPlan(diffSnapshots(before, after))

  expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
  const emitted = emitMigrationPlan(planned.plan, { afterSnapshot: after })

  expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
  const declaration = emitted.statements.findIndex((statement) =>
    statement.sql.startsWith(kind === "domain" ? "CREATE DOMAIN " : "CREATE TYPE "),
  )
  const use = emitted.statements.findIndex((statement) =>
    statement.sql.includes('"balance" public.positive_balance'),
  )

  expect(declaration, emitted.sql).toBeGreaterThanOrEqual(0)
  expect(use, emitted.sql).toBeGreaterThanOrEqual(0)
  // A table declaration absorbs its column operations, so compare executable SQL order.
  expect(declaration, emitted.sql).toBeLessThan(use)
})
