import { expect, expectTypeOf, test } from "vitest"

import type { Dialect } from "../src/core/index.ts"
import { postgresDialect } from "../src/dialects/postgres.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import { render } from "../src/index.ts"
import {
  namedPostgresDialect,
  portableQuery,
  postgresOnlyQuery,
} from "./dialect-capabilities-fixtures.ts"

test("renders a capability-bearing query with a supporting dialect", () => {
  expect(render(postgresOnlyQuery, postgresDialect())).toEqual({
    text: 'SELECT "users"."name" AS "name" FROM "users" WHERE ("users"."name" ILIKE $1)',
    parameters: ["%ada%"],
  })

  expect(render(postgresOnlyQuery, namedPostgresDialect)).toEqual({
    text: 'SELECT "users"."name" AS "name" FROM "users" WHERE ("users"."name" ILIKE :p1)',
    parameters: ["%ada%"],
  })

  expectTypeOf(postgresDialect()).toMatchTypeOf<
    Dialect<"ilike" | "json" | "on-conflict" | "row-locking">
  >()
})

test("keeps portable features renderable by every dialect", () => {
  expect(render(portableQuery)).toEqual({
    text: 'SELECT "users"."name" AS "name" FROM "users" WHERE ("users"."name" LIKE ?)',
    parameters: ["%ada%"],
  })

  expect(render(portableQuery, sqliteDialect())).toEqual({
    text: 'SELECT "users"."name" AS "name" FROM "users" WHERE ("users"."name" LIKE ?)',
    parameters: ["%ada%"],
  })
})

test("diagnoses unsupported capabilities at runtime when types are bypassed", () => {
  expect(() => render(postgresOnlyQuery, sqliteDialect() as unknown as Dialect)).toThrow(
    'Dialect "sqlite" does not support the "ilike" capability',
  )
})
