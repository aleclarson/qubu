import { schema } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

function domainSnapshot(constrained: boolean): SchemaSnapshot {
  const base = createSchemaSnapshot(schema({}, { namespace: "public" }), {
    dialect: postgresSchemaDialect,
  })

  return {
    ...base,
    domains: [
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
        constraints: constrained
          ? [
              {
                kind: "check",
                id: "positive",
                physicalName: "positive",
                expression: {
                  kind: "expression",
                  expressionKind: "raw",
                  sql: "VALUE > 0",
                },
              },
            ]
          : [],
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

test.each(["create", "add", "remove"] as const)(
  "targets a PostgreSQL domain when applying its check constraint (%s)",
  (operation) => {
    const constrained = domainSnapshot(true)
    const unconstrained = domainSnapshot(false)
    const before =
      operation === "create"
        ? {
            ...constrained,
            domains: [],
          }
        : operation === "add"
          ? unconstrained
          : constrained
    const after = operation === "remove" ? unconstrained : constrained
    const sql = emitChange(before, after)

    if (operation === "remove") {
      expect(sql).toContain('ALTER DOMAIN "public"."positive_balance" DROP CONSTRAINT "positive"')
    } else {
      // Creation may inline the check or add it afterward with ALTER DOMAIN.
      expect(sql).toContain("CHECK (VALUE > 0)")
      expect(sql).toContain('"positive"')
      expect(sql).not.toContain('ALTER TABLE "public"."positive_balance"')
    }
  },
)

test("creates an unconstrained PostgreSQL domain", () => {
  const after = domainSnapshot(false)
  const sql = emitChange(
    {
      ...after,
      domains: [],
    },
    after,
  )

  expect(sql).toBe('CREATE DOMAIN "public"."positive_balance" AS integer NOT NULL;')
})
