import { integer, json, nativeColumn, schema, table, text, timestamp } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { defineSchemaExpression } from "qubu/schema"
import { createSchemaSnapshot } from "qubu/snapshot"
import { mysqlSchemaDialect } from "qubu/snapshot/mysql"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/mysql.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

const jsonObject = defineSchemaExpression("function", (context) => context.append("JSON_OBJECT()"))
const absoluteValue = defineSchemaExpression("function", (context) => context.append("ABS(-1)"))
const currentTimestamp = defineSchemaExpression("function", (context) =>
  context.append("CURRENT_TIMESTAMP"),
)

test.each([
  {
    name: "TEXT literal",
    definition: text({ default: "queued" }),
    expected: /DEFAULT\s+\('queued'\)/u,
  },
  {
    name: "JSON expression",
    definition: json({ default: jsonObject }),
    expected: /DEFAULT\s+\(JSON_OBJECT\(\)\)/u,
  },
  {
    name: "integer expression",
    definition: integer({ default: absoluteValue }),
    expected: /DEFAULT\s+\(ABS\(-1\)\)/u,
  },
  {
    name: "VARCHAR literal",
    definition: nativeColumn("mysql", "VARCHAR(32)", { default: "queued" }),
    expected: /DEFAULT\s+(?:'queued'|\('queued'\))/u,
  },
  {
    name: "integer literal",
    definition: integer({ default: 1 }),
    expected: /DEFAULT\s+(?:1|\(1\))/u,
  },
  {
    name: "timestamp expression",
    definition: timestamp({ default: currentTimestamp }),
    expected: /DEFAULT\s+(?:CURRENT_TIMESTAMP|\(CURRENT_TIMESTAMP\))/u,
  },
])("emits valid MySQL default syntax for a $name", ({ definition, expected }) => {
  const jobs = table("jobs", { setting: definition })
  const options = { dialect: mysqlSchemaDialect }
  const before = createSchemaSnapshot(schema({}, { namespace: "app" }), options)
  const after = createSchemaSnapshot(schema({ jobs }, { namespace: "app" }), options)
  const planned = createMigrationPlan(diffSnapshots(before, after))

  expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
  const emitted = emitMigrationPlan(planned.plan, { afterSnapshot: after })

  expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
  expect(emitted.statements).toHaveLength(1)
  // TEXT literals and non-timestamp expressions need expression-default parentheses.
  // https://dev.mysql.com/doc/refman/8.4/en/data-type-defaults.html
  expect(emitted.sql).toMatch(expected)
})
