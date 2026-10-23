import { integer, schema, table } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

function viewSnapshot(predicate: string): SchemaSnapshot {
  const records = table("records", { value: integer() })
  const base = createSchemaSnapshot(schema({ records }, { namespace: "public" }), {
    dialect: postgresSchemaDialect,
  })

  return {
    ...base,
    views: [
      {
        kind: "view",
        id: "visible_records",
        physicalName: "visible_records",
        columns: base.tables[0]!.columns.map((column) => ({
          ...column,
          physicalName: "public_value",
        })),
        definition: {
          kind: "expression",
          expressionKind: "raw",
          sql: `SELECT value FROM public.records WHERE ${predicate}`,
        },
        dependencies: [
          {
            kind: "table",
            id: "records",
          },
        ],
      },
    ],
  }
}

test.each(["create", "replace"] as const)(
  "preserves declared PostgreSQL view output names during %s",
  (operation) => {
    const after = viewSnapshot("value > 1")
    const before =
      operation === "create"
        ? {
            ...after,
            views: [],
          }
        : viewSnapshot("value > 0")
    const planned = createMigrationPlan(diffSnapshots(before, after), {
      allowReviewRequired: true,
    })

    expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
    const emitted = emitMigrationPlan(planned.plan, { afterSnapshot: after })

    expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
    expect(emitted.statements).toHaveLength(1)
    // Omitting the output list attempts to rename public_value to value,
    // which PostgreSQL rejects even though only the view's filter changed.
    expect(emitted.sql).toBe(
      `CREATE ${operation === "replace" ? "OR REPLACE " : ""}VIEW "public"."visible_records" ("public_value") AS SELECT value FROM public.records WHERE value > 1;`,
    )
  },
)
