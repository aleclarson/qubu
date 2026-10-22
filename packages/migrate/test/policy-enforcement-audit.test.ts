import { integer, schema, table } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

test.each([true, false])(
  "preserves PostgreSQL policy permissive=%s beside an existing permissive policy",
  (permissive) => {
    const records = table("records", { value: integer() })
    const base = createSchemaSnapshot(schema({ records }, { namespace: "public" }), {
      dialect: postgresSchemaDialect,
    })
    const allowAll: SchemaSnapshot["policies"][number] = {
      kind: "policy",
      id: "allow_all",
      physicalName: "allow_all",
      table: {
        kind: "table",
        id: "records",
      },
      command: "all",
      permissive: true,
      using: {
        kind: "expression",
        expressionKind: "raw",
        sql: "true",
      },
      check: {
        kind: "expression",
        expressionKind: "raw",
        sql: "true",
      },
    }
    const before: SchemaSnapshot = {
      ...base,
      policies: [allowAll],
    }
    const after: SchemaSnapshot = {
      ...before,
      policies: [
        allowAll,
        {
          ...allowAll,
          id: "positive_only",
          physicalName: "positive_only",
          permissive,
          using: {
            kind: "expression",
            expressionKind: "raw",
            sql: "value > 0",
          },
          check: {
            kind: "expression",
            expressionKind: "raw",
            sql: "value > 0",
          },
        },
      ],
    }
    const planned = createMigrationPlan(diffSnapshots(before, after), { allowReviewRequired: true })

    expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
    const emitted = emitMigrationPlan(planned.plan, {
      afterSnapshot: after,
      serverVersion: "17.0",
    })

    expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
    expect(emitted.sql).toContain('CREATE POLICY "positive_only" ON "public"."records"')
    expect(emitted.sql).toContain("USING (value > 0)")
    expect(emitted.sql).toContain("WITH CHECK (value > 0)")

    if (permissive) {
      expect(emitted.sql).not.toContain("AS RESTRICTIVE")
    } else {
      // A restrictive policy must be ANDed with existing permissive policies.
      expect(emitted.sql).toContain("AS RESTRICTIVE")
    }
  },
)
