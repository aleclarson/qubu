import { integer, schema, table } from "qubu"
import { diffSnapshots } from "qubu/diff"
import type { SchemaDialect } from "qubu/schema"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { mysqlSchemaDialect } from "qubu/snapshot/mysql"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/index.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

type View = SchemaSnapshot["views"][number]

function viewSnapshot(
  predicate: string,
  options: Pick<View, "checkOption" | "securityInvoker" | "securityBarrier">,
  dialect: SchemaDialect = postgresSchemaDialect,
) {
  const records = table("records", { value: integer() })
  const base = createSchemaSnapshot(schema({ records }, { namespace: "public" }), {
    dialect,
  })
  const snapshot: SchemaSnapshot = {
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
          sql: `SELECT value FROM public.records WHERE ${predicate}`,
        },
        dependencies: [
          {
            kind: "table",
            id: "records",
          },
        ],
        ...options,
      },
    ],
  }

  return snapshot
}

function emitChange(
  before: SchemaSnapshot,
  after: SchemaSnapshot,
  dialect: SchemaDialect = postgresSchemaDialect,
) {
  const planned = createMigrationPlan(diffSnapshots(before, after), {
    allowReviewRequired: true,
  })

  expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
  const emitted = emitMigrationPlan(planned.plan, dialect, {
    afterSnapshot: after,
    serverVersion: dialect.name === "mysql" ? "8.4" : "17.0",
  })

  expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
  return emitted.sql
}

test.each(["none", "local", "cascaded"] as const)(
  "preserves PostgreSQL view check option %s when replacing its definition",
  (checkOption) => {
    const before = viewSnapshot("value > 0", { checkOption })
    const after = viewSnapshot("value > 1", { checkOption })
    const sql = emitChange(before, after)

    expect(sql).toContain("CREATE OR REPLACE VIEW")
    if (checkOption === "none") {
      expect(sql).not.toContain("CHECK OPTION")
    } else {
      expect(sql).toContain(`WITH ${checkOption.toUpperCase()} CHECK OPTION`)
    }
  },
)

for (const operation of ["create", "replace"] as const) {
  test.each([false, true])(
    `preserves MySQL view security_invoker=%s during ${operation}`,
    (securityInvoker) => {
      const after = viewSnapshot("value > 1", { securityInvoker }, mysqlSchemaDialect)
      const before =
        operation === "create"
          ? {
              ...after,
              views: [],
            }
          : viewSnapshot("value > 0", { securityInvoker }, mysqlSchemaDialect)
      const sql = emitChange(before, after, mysqlSchemaDialect)

      // MySQL defaults omitted SQL SECURITY to DEFINER, which changes whose
      // privileges protect the underlying table.
      // https://dev.mysql.com/doc/refman/8.4/en/create-view.html
      if (securityInvoker) {
        expect(sql).toMatch(/\bSQL\s+SECURITY\s+INVOKER\s+VIEW\b/iu)
      } else {
        expect(sql).not.toMatch(/\bSQL\s+SECURITY\s+INVOKER\b/iu)
      }
    },
  )
}

test.each([
  {
    operation: "create",
    securityBarrier: false,
  },
  {
    operation: "create",
    securityBarrier: true,
  },
  {
    operation: "replace",
    securityBarrier: false,
  },
  {
    operation: "replace",
    securityBarrier: true,
  },
] as const)(
  "preserves PostgreSQL view security_barrier=$securityBarrier during $operation",
  ({ operation, securityBarrier }) => {
    const after = viewSnapshot("value > 1", { securityBarrier })
    const before =
      operation === "create"
        ? {
            ...after,
            views: [],
          }
        : viewSnapshot("value > 0", { securityBarrier })
    const sql = emitChange(before, after)

    if (securityBarrier) {
      expect(sql).toMatch(/"?security_barrier"?\s*=\s*(?:true|'true')/i)
    } else {
      expect(sql).not.toMatch(/"?security_barrier"?\s*=\s*(?:true|'true')/i)
    }
  },
)

test.each([
  {
    operation: "create",
    securityInvoker: false,
  },
  {
    operation: "create",
    securityInvoker: true,
  },
  {
    operation: "replace",
    securityInvoker: false,
  },
  {
    operation: "replace",
    securityInvoker: true,
  },
] as const)(
  "preserves PostgreSQL view security_invoker=$securityInvoker during $operation",
  ({ operation, securityInvoker }) => {
    const after = viewSnapshot("value > 1", { securityInvoker })
    const before =
      operation === "create"
        ? {
            ...after,
            views: [],
          }
        : viewSnapshot("value > 0", { securityInvoker })
    const sql = emitChange(before, after)

    if (securityInvoker) {
      // Omitting this option defaults to the view owner's underlying privileges.
      expect(sql).toMatch(/"?security_invoker"?\s*=\s*(?:true|'true')/i)
    } else {
      expect(sql).not.toMatch(/"?security_invoker"?\s*=\s*(?:true|'true')/i)
    }
  },
)
