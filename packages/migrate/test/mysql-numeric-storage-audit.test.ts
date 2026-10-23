import { nativeColumn, numeric, schema, table } from "qubu"
import { diffSnapshots } from "qubu/diff"
import {
  createSchemaSnapshot,
  type SchemaSnapshot,
  type SchemaSnapshotOptions,
} from "qubu/snapshot"
import { mysqlSchemaDialect } from "qubu/snapshot/mysql"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/mysql.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

function emitCreateTable(after: SchemaSnapshot) {
  const before = createSchemaSnapshot(schema({}, { namespace: "app" }), {
    dialect: mysqlSchemaDialect,
  })
  const planned = createMigrationPlan(diffSnapshots(before, after))

  expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
  const emitted = emitMigrationPlan(planned.plan, { afterSnapshot: after })

  expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
  expect(emitted.statements).toHaveLength(1)
  return emitted.sql
}

test.each(["dialect", "portable"] as const)(
  "emits fractional MySQL numeric storage from a %s snapshot",
  (mode) => {
    const measurements = table("measurements", { amount: numeric() })
    const options: SchemaSnapshotOptions = {
      dialect: mysqlSchemaDialect,
      ...(mode === "portable" ? { storageEncoder: (storage) => storage } : {}),
    }
    const after = createSchemaSnapshot(schema({ measurements }, { namespace: "app" }), options)

    expect(after.tables[0]?.columns[0]?.storage?.kind).toBe(
      mode === "portable" ? "portable" : "native",
    )
    // Bare DECIMAL defaults to scale zero: the generated column stores 12.5 as 13.
    // Allow fractional decimal or floating storage without choosing a precision policy.
    expect(emitCreateTable(after)).toMatch(
      /`amount`\s+(?:(?:DECIMAL|NUMERIC)\s*\(\s*\d+\s*,\s*[1-9]\d*\s*\)|DOUBLE(?:\s+PRECISION)?|FLOAT(?:\(\d+\))?|REAL)\s+NOT NULL/iu,
    )
  },
)

test.each(["DECIMAL(10,2)", "DOUBLE"])(
  "preserves an explicit MySQL %s fractional declaration",
  (declaration) => {
    const measurements = table("measurements", {
      amount: nativeColumn("mysql", declaration),
    })
    const after = createSchemaSnapshot(schema({ measurements }, { namespace: "app" }), {
      dialect: mysqlSchemaDialect,
    })

    expect(emitCreateTable(after)).toBe(
      `CREATE TABLE \`app\`.\`measurements\` (\`amount\` ${declaration} NOT NULL);`,
    )
  },
)
