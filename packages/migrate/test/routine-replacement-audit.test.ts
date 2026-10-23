import { schema } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

function snapshot(body: string): SchemaSnapshot {
  const base = createSchemaSnapshot(schema({}, { namespace: "public" }), {
    dialect: postgresSchemaDialect,
  })

  return {
    ...base,
    routines: [
      {
        kind: "routine",
        id: "private_value",
        physicalName: "private_value",
        routineKind: "function",
        parameters: [],
        returnType: {
          kind: "native",
          dialect: "postgresql",
          type: "text",
        },
        language: "sql",
        body: {
          kind: "expression",
          expressionKind: "raw",
          sql: body,
        },
      },
    ],
  }
}

test.each(["create", "replace"] as const)(
  "avoids dropping PostgreSQL function permissions during %s",
  (operation) => {
    const after = snapshot("SELECT 'new'::text")
    const before =
      operation === "create"
        ? {
            ...after,
            routines: [],
          }
        : snapshot("SELECT 'old'::text")
    const planned = createMigrationPlan(diffSnapshots(before, after), {
      allowReviewRequired: true,
    })

    expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
    const emitted = emitMigrationPlan(planned.plan, { afterSnapshot: after })

    expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
    expect(emitted.statements).toHaveLength(1)
    // DROP/recreate discards revoked PUBLIC EXECUTE privileges; replacing a
    // compatible function body in place preserves its existing ACL and identity.
    expect(emitted.sql).not.toMatch(/\bDROP FUNCTION\b/iu)
    expect(emitted.sql).toContain(
      operation === "replace"
        ? 'CREATE OR REPLACE FUNCTION "public"."private_value"()'
        : 'CREATE FUNCTION "public"."private_value"()',
    )
  },
)
