import { binary, nativeColumn, schema, table } from "qubu"
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
  "emits valid MySQL binary storage from a %s snapshot",
  (mode) => {
    const attachments = table("attachments", { body: binary() })
    const options: SchemaSnapshotOptions = {
      dialect: mysqlSchemaDialect,
      ...(mode === "portable" ? { storageEncoder: (storage) => storage } : {}),
    }
    const after = createSchemaSnapshot(schema({ attachments }, { namespace: "app" }), options)

    expect(after.tables[0]?.columns[0]?.storage?.kind).toBe(
      mode === "portable" ? "portable" : "native",
    )
    // MySQL requires a length for VARBINARY; BLOB types need no length.
    // https://dev.mysql.com/doc/refman/8.4/en/string-type-syntax.html
    expect(emitCreateTable(after)).toMatch(
      /`body`\s+(?:VARBINARY\s*\(\s*\d+\s*\)|(?:TINY|MEDIUM|LONG)?BLOB)\s+NOT NULL/iu,
    )
  },
)

test.each(["VARBINARY(32)", "BLOB"])(
  "preserves an explicit MySQL %s binary declaration",
  (declaration) => {
    const attachments = table("attachments", { body: nativeColumn("mysql", declaration) })
    const after = createSchemaSnapshot(schema({ attachments }, { namespace: "app" }), {
      dialect: mysqlSchemaDialect,
    })

    expect(emitCreateTable(after)).toBe(
      `CREATE TABLE \`app\`.\`attachments\` (\`body\` ${declaration} NOT NULL);`,
    )
  },
)
