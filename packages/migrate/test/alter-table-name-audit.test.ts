import { integer, schema, table } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot } from "qubu/snapshot"
import { mysqlSchemaDialect } from "qubu/snapshot/mysql"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { sqliteSchemaDialect } from "qubu/snapshot/sqlite"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/index.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

for (const dialect of [postgresSchemaDialect, mysqlSchemaDialect, sqliteSchemaDialect]) {
  test.each(["account_records", "accounts"])(
    `adds a column to the physical table %s in ${dialect.name}`,
    (physicalName) => {
      const namespace = dialect.name === "sqlite" ? "main" : "app"
      const before = createSchemaSnapshot(
        schema({ accounts: table(physicalName, { id: integer() }) }, { namespace }),
        { dialect },
      )
      const after = createSchemaSnapshot(
        schema(
          {
            accounts: table(physicalName, {
              id: integer(),
              quota: integer({ default: 2 }),
            }),
          },
          { namespace },
        ),
        { dialect },
      )
      const planned = createMigrationPlan(diffSnapshots(before, after))

      expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
      expect(planned.plan.operations.map((operation) => operation.kind)).toEqual(["column"])
      const emitted = emitMigrationPlan(planned.plan, dialect, { afterSnapshot: after })

      expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
      expect(emitted.statements).toHaveLength(1)
      const target = `${dialect.quoteIdentifier(namespace)}.${dialect.quoteIdentifier(physicalName)}`

      expect(emitted.sql).toContain(`ALTER TABLE ${target} ADD COLUMN`)
    },
  )
}
