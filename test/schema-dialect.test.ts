import { expect, expectTypeOf, test } from "vitest"

import { createDialect } from "../src/core/index.ts"
import type { Dialect } from "../src/core/index.ts"
import { postgresDialect } from "../src/dialects/postgres.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import { value } from "../src/index.ts"
import { createSchemaDialect } from "../src/schema/index.ts"
import { renderSchemaExpression, unsafeSchemaSql } from "../src/schema/index.ts"
import { postgresSchemaDialect, postgresSnapshotAdapter } from "../src/snapshot/index.ts"

test("inherits query identifier, placeholder, and capability policy", () => {
  const queryDialect = postgresDialect()
  const schemaDialect = createSchemaDialect(queryDialect, { version: 1 })

  expect(schemaDialect.name).toBe(queryDialect.name)
  expect(schemaDialect.quoteIdentifier('a"b')).toBe('"a""b"')
  expect(schemaDialect.placeholder(2)).toBe("$2")
  expect(schemaDialect.capabilities).toEqual(queryDialect.capabilities)
  expect(schemaDialect.json).toBe(queryDialect.json)
  expect(schemaDialect.castTypes).toBe(queryDialect.castTypes)
  expectTypeOf(schemaDialect).toMatchTypeOf<
    Dialect<"ilike" | "json" | "on-conflict" | "row-locking">
  >()
})

test("shares a custom query literal policy with schema rendering", () => {
  const queryDialect = createDialect({
    name: "shared-policy",
    placeholder: (position) => `:p${position}`,
    quoteIdentifier: (identifier) => `[${identifier}]`,
    renderSchemaLiteral: (value) => `LITERAL(${String(value)})`,
  })
  const schemaDialect = createSchemaDialect(queryDialect, { version: 1 })

  expect(
    renderSchemaExpression(value(42), {
      mode: "default",
      dialect: schemaDialect,
    }).text,
  ).toBe("LITERAL(42)")
  expect(schemaDialect.quoteIdentifier("name")).toBe("[name]")
  expect(schemaDialect.placeholder(3)).toBe(":p3")
})

test("uses one PostgreSQL identity for query and schema rendering", () => {
  expect(postgresSchemaDialect.name).toBe(postgresDialect().name)
  expect(postgresSchemaDialect.name).toBe("postgresql")
  expect(postgresSnapshotAdapter.dialect).toBe(postgresSchemaDialect)
})

test("rejects unsafe schema SQL tagged for another dialect", () => {
  expect(() =>
    renderSchemaExpression(unsafeSchemaSql("sqlite", "CURRENT_DATE"), {
      mode: "default",
      dialect: postgresSchemaDialect,
    }),
  ).toThrow(/tagged for "sqlite"/)

  const sqliteSchema = createSchemaDialect(sqliteDialect(), { version: 1 })

  expect(() =>
    renderSchemaExpression(unsafeSchemaSql("postgresql", "CURRENT_DATE"), {
      mode: "default",
      dialect: sqliteSchema,
    }),
  ).toThrow(/tagged for "postgresql"/)
})
