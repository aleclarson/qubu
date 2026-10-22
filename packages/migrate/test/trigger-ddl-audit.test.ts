import { integer, schema, table } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

function triggerSnapshot(conditional = false): SchemaSnapshot {
  const records = table("records", { value: integer() })
  const base = createSchemaSnapshot(schema({ records }, { namespace: "public" }), {
    dialect: postgresSchemaDialect,
  })

  return {
    ...base,
    triggers: [
      {
        kind: "trigger",
        id: "audit_guard",
        physicalName: "audit_guard",
        table: {
          kind: "table",
          id: "records",
        },
        timing: "before",
        events: ["update"],
        orientation: "row",
        body: {
          kind: "expression",
          expressionKind: "raw",
          sql: "EXECUTE FUNCTION public.audit_record()",
        },
        ...(conditional
          ? {
              condition: {
                kind: "expression" as const,
                expressionKind: "raw",
                sql: 'OLD."value" IS DISTINCT FROM NEW."value"',
              },
            }
          : {}),
      },
    ],
  }
}

function emitChange(before: SchemaSnapshot, after: SchemaSnapshot) {
  const planned = createMigrationPlan(diffSnapshots(before, after), {
    allowReviewRequired: true,
    allowDestructive: true,
  })

  expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
  const emitted = emitMigrationPlan(planned.plan, {
    afterSnapshot: after,
    allowDestructive: true,
  })

  expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
  return emitted.sql
}

test("qualifies the PostgreSQL trigger table without qualifying its trigger name", () => {
  const after = triggerSnapshot()
  const sql = emitChange(
    {
      ...after,
      triggers: [],
    },
    after,
  )

  expect(sql).toBe(
    'CREATE TRIGGER "audit_guard" BEFORE UPDATE ON "public"."records" FOR EACH ROW EXECUTE FUNCTION public.audit_record();',
  )
})

test("places a PostgreSQL trigger condition before its action", () => {
  const after = triggerSnapshot(true)
  const sql = emitChange(
    {
      ...after,
      triggers: [],
    },
    after,
  )

  expect(sql).toContain(
    'FOR EACH ROW WHEN (OLD."value" IS DISTINCT FROM NEW."value") EXECUTE FUNCTION public.audit_record()',
  )
})

test("omits WHEN for an unconditional PostgreSQL trigger", () => {
  const after = triggerSnapshot()
  const sql = emitChange(
    {
      ...after,
      triggers: [],
    },
    after,
  )

  expect(sql).toContain("FOR EACH ROW EXECUTE FUNCTION public.audit_record()")
  expect(sql).not.toContain("WHEN")
})

test("names the owning table when dropping a PostgreSQL trigger", () => {
  const before = triggerSnapshot()
  const sql = emitChange(before, {
    ...before,
    triggers: [],
  })

  expect(sql).toBe('DROP TRIGGER "audit_guard" ON "public"."records";')
})
