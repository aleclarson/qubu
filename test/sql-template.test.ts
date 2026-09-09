import { expect, test } from "vitest"

import { identifier, unsafeExpression } from "../src/core/index.ts"
import { postgresDialect } from "../src/dialects/postgres.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import { eq, from, render, select, sql, value, where } from "../src/index.ts"
import type { Dialect, SqlBoolean } from "../src/index.ts"
import { postgresPredicate, users } from "./sql-template-fixtures.ts"

test("binds ordinary template substitutions and renders fragment substitutions", () => {
  const fragment = sql`COALESCE(${users.name}, ${"O'Reilly"}) = ${value("Ada")}`

  expect(render(fragment)).toEqual({
    text: 'COALESCE("users"."name", ?) = ?',
    parameters: ["O'Reilly", "Ada"],
  })
})

test("composes nested templates and queries in one placeholder sequence", () => {
  const selectedNames = select({ displayName: users.name }, from(users), where(eq(users.id, 7)))
  const namePredicate = sql`${users.name} = ${"Ada"}`.$type<boolean, SqlBoolean>()
  const fragment = sql`EXISTS (${selectedNames}) AND (${namePredicate})`

  expect(render(fragment, postgresDialect())).toEqual({
    text: 'EXISTS (SELECT "users"."name" AS "display_name" FROM "users" WHERE ("users"."id" = $1)) AND ("users"."name" = $2)',
    parameters: [7, "Ada"],
  })
})

test("requires explicit fragments for runtime identifiers and syntax", () => {
  const fieldName = "displayName"
  const direction = "DESC"
  const fragment = sql`${fieldName} ${identifier(fieldName)} ${direction} ${unsafeExpression(direction)}`

  expect(render(fragment)).toEqual({
    text: '? "displayName" ? DESC',
    parameters: [fieldName, direction],
  })
})

test("retains dialect capability checks through template composition", () => {
  expect(render(postgresPredicate, postgresDialect())).toEqual({
    text: '"users"."name" ILIKE $1',
    parameters: ["%ada%"],
  })

  expect(() => render(postgresPredicate, sqliteDialect() as unknown as Dialect)).toThrow(
    'Dialect "sqlite" does not support the "ilike" capability',
  )
})

test("preserves rendering and capability checks after output annotations", () => {
  const selectedNames = select({ name: users.name }, from(users), where(eq(users.id, 7)))
  const original = sql`EXISTS (${selectedNames}) AND (${postgresPredicate})`
  const annotated = original.$type<boolean, SqlBoolean>()

  expect(render(annotated, postgresDialect())).toEqual(render(original, postgresDialect()))
  expect(render(annotated.$type<true>(), postgresDialect())).toEqual({
    text: 'EXISTS (SELECT "users"."name" AS "name" FROM "users" WHERE ("users"."id" = $1)) AND ("users"."name" ILIKE $2)',
    parameters: [7, "%ada%"],
  })
  expect(() => render(annotated, sqliteDialect() as unknown as Dialect)).toThrow(
    'Dialect "sqlite" does not support the "ilike" capability',
  )
})
