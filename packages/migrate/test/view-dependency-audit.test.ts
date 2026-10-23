import { integer, schema, table } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

test.each(["create", "remove"] as const)(
  "respects PostgreSQL view dependencies during %s",
  (operation) => {
    const base = createSchemaSnapshot(
      schema({ records: table("records", { value: integer() }) }, { namespace: "public" }),
      { dialect: postgresSchemaDialect },
    )
    const populated: SchemaSnapshot = {
      ...base,
      views: [
        {
          kind: "view",
          id: "visible_records",
          physicalName: "visible_records",
          columns: base.tables[0]!.columns,
          definition: {
            kind: "expression",
            expressionKind: "raw",
            sql: "SELECT value FROM public.records",
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
    const empty: SchemaSnapshot = {
      ...base,
      tables: [],
      views: [],
    }
    const before = operation === "create" ? empty : populated
    const after = operation === "create" ? populated : empty
    const planned = createMigrationPlan(diffSnapshots(before, after), {
      allowDestructive: true,
      allowReviewRequired: true,
    })

    expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
    const emitted = emitMigrationPlan(planned.plan, {
      afterSnapshot: after,
      allowDestructive: true,
    })

    expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
    const verb = operation === "create" ? "CREATE" : "DROP"
    const tablePosition = emitted.statements.findIndex((statement) =>
      statement.sql.startsWith(`${verb} TABLE `),
    )
    const viewPosition = emitted.statements.findIndex((statement) =>
      statement.sql.startsWith(`${verb} VIEW `),
    )

    expect(tablePosition, emitted.sql).toBeGreaterThanOrEqual(0)
    expect(viewPosition, emitted.sql).toBeGreaterThanOrEqual(0)
    if (operation === "create") {
      expect(tablePosition, emitted.sql).toBeLessThan(viewPosition)
    } else {
      expect(viewPosition, emitted.sql).toBeLessThan(tablePosition)
    }
  },
)
