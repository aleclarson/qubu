import { schema } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

function emitSequence(type?: "smallint" | "integer" | "bigint") {
  const before = createSchemaSnapshot(schema({}, { namespace: "public" }), {
    dialect: postgresSchemaDialect,
  })
  const after: SchemaSnapshot = {
    ...before,
    sequences: [
      {
        kind: "sequence",
        id: "ticket_seq",
        physicalName: "ticket_seq",
        ...(type === undefined
          ? {}
          : {
              storage: {
                kind: "native",
                dialect: "postgresql",
                type,
              },
            }),
      },
    ],
  }
  const planned = createMigrationPlan(diffSnapshots(before, after))

  expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
  const emitted = emitMigrationPlan(planned.plan, { afterSnapshot: after })

  expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
  return emitted.sql
}

test.each(["smallint", "integer"] as const)(
  "preserves the declared PostgreSQL %s sequence type and its implicit bounds",
  (type) => {
    // Omitting AS widens the sequence to BIGINT, including its default maximum.
    expect(emitSequence(type)).toMatch(new RegExp(`\\bAS\\s+${type}\\b`, "iu"))
  },
)

test.each([undefined, "bigint"] as const)(
  "allows PostgreSQL's default BIGINT sequence type for storage %s",
  (type) => {
    expect(emitSequence(type)).toMatch(/^CREATE SEQUENCE "public"\."ticket_seq"(?: AS BIGINT)?;$/iu)
  },
)
