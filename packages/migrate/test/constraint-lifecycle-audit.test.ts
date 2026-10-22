import { check, gt, index, integer, schema, table } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot } from "qubu/snapshot"
import { mysqlSchemaDialect } from "qubu/snapshot/mysql"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { expect, test } from "vitest"

import * as mysqlDdl from "../src/ddl/mysql.ts"
import * as postgresDdl from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

test("removes a MySQL CHECK constraint while retaining a same-named index", () => {
  const records = table("records", { score: integer() }, (columns) => ({
    constraints: { positive: check(gt(columns.score, 0)) },
    indexes: { positive: index([columns.score]) },
  }))
  const before = createSchemaSnapshot(schema({ records }, { namespace: "public" }), {
    dialect: mysqlSchemaDialect,
  })
  const after = {
    ...before,
    tables: before.tables.map((entry) => ({
      ...entry,
      constraints: [],
    })),
  }
  const planned = createMigrationPlan(diffSnapshots(before, after), { allowDestructive: true })

  expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
  const emitted = mysqlDdl.emitMigrationPlan(planned.plan, {
    allowDestructive: true,
    serverVersion: "8.4.0",
    afterSnapshot: after,
  })

  expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
  expect(emitted.sql).toBe("ALTER TABLE `public`.`records` DROP CHECK `positive`;")
})

test.each([false, true])(
  "preserves PostgreSQL CHECK validation policy when adding a constraint (NOT VALID: %s)",
  (notValid) => {
    const records = table("records", { score: integer() }, (columns) => ({
      constraints: {
        positive: check(gt(columns.score, 0), {
          validated: !notValid,
          dialect: {
            dialect: "postgresql",
            notValid,
          },
        }),
      },
      indexes: {},
    }))
    const after = createSchemaSnapshot(schema({ records }, { namespace: "public" }), {
      dialect: postgresSchemaDialect,
    })
    const before = {
      ...after,
      tables: after.tables.map((entry) => ({
        ...entry,
        constraints: [],
      })),
    }
    const planned = createMigrationPlan(diffSnapshots(before, after))

    expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
    const emitted = postgresDdl.emitMigrationPlan(planned.plan, { afterSnapshot: after })

    expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
    if (notValid) {
      expect(emitted.sql).toContain(" NOT VALID")
    } else {
      expect(emitted.sql).not.toContain(" NOT VALID")
    }
  },
)
