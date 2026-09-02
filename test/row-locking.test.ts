import { expect, expectTypeOf, test } from "vitest"

import { mysqlDialect } from "../src/dialects/mysql.ts"
import { postgresDialect } from "../src/dialects/postgres.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import { standardDialect } from "../src/dialects/standard.ts"
import type { Dialect } from "../src/index.ts"
import {
  QueryValidationError,
  eq,
  fetchFirst,
  from,
  integer,
  offset,
  render,
  rowLock,
  select,
  table,
  text,
  where,
} from "../src/index.ts"

const users = table("users", {
  id: integer(),
  email: text({ nullable: true }),
})

test("renders PostgreSQL row locks after pagination and preserves parameter order", () => {
  const query = select(
    {
      id: users.id,
      email: users.email,
    },
    rowLock("update", "skip-locked"),
    fetchFirst(10),
    where(eq(users.id, 7)),
    offset(5),
    from(users),
  )

  expect(render(query, postgresDialect())).toEqual({
    text: 'SELECT "users"."id" AS "id", "users"."email" AS "email" FROM "users" WHERE ("users"."id" = $1) LIMIT $2 OFFSET $3 FOR UPDATE SKIP LOCKED',
    parameters: [7, 10, 5],
    parameterSqlTypes: [undefined, "integer", "integer"],
  })
  expectTypeOf(query.row).toEqualTypeOf<{
    id: number
    email: string | null
  }>()
})

test("renders every PostgreSQL row-lock mode and wait policy", () => {
  const cases = [
    ["update", "default", "FOR UPDATE"],
    ["update", "nowait", "FOR UPDATE NOWAIT"],
    ["update", "skip-locked", "FOR UPDATE SKIP LOCKED"],
    ["no-key-update", "default", "FOR NO KEY UPDATE"],
    ["no-key-update", "nowait", "FOR NO KEY UPDATE NOWAIT"],
    ["no-key-update", "skip-locked", "FOR NO KEY UPDATE SKIP LOCKED"],
    ["share", "default", "FOR SHARE"],
    ["share", "nowait", "FOR SHARE NOWAIT"],
    ["share", "skip-locked", "FOR SHARE SKIP LOCKED"],
    ["key-share", "default", "FOR KEY SHARE"],
    ["key-share", "nowait", "FOR KEY SHARE NOWAIT"],
    ["key-share", "skip-locked", "FOR KEY SHARE SKIP LOCKED"],
  ] as const

  for (const [mode, wait, suffix] of cases) {
    const query = select({ id: users.id }, from(users), rowLock(mode, wait))

    expect(render(query, postgresDialect()).text).toBe(
      `SELECT "users"."id" AS "id" FROM "users" ${suffix}`,
    )
  }
})

test("renders MySQL-compatible row locks without adding parameters", () => {
  const query = select(
    { id: users.id },
    from(users),
    where(eq(users.id, 7)),
    rowLock("share", "nowait"),
  )

  expect(render(query, mysqlDialect())).toEqual({
    text: "SELECT `users`.`id` AS `id` FROM `users` WHERE (`users`.`id` = ?) FOR SHARE NOWAIT",
    parameters: [7],
  })

  expect(
    render(select({ id: users.id }, from(users), rowLock("update", "skip-locked")), mysqlDialect())
      .text,
  ).toBe("SELECT `users`.`id` AS `id` FROM `users` FOR UPDATE SKIP LOCKED")
})

test("reports MySQL row-lock modes that are not supported", () => {
  const query = select({ id: users.id }, from(users), rowLock("key-share"))

  expect(() => render(query, mysqlDialect())).toThrowError(QueryValidationError)
  try {
    render(query, mysqlDialect())
  } catch (error) {
    expect(error).toBeInstanceOf(QueryValidationError)
    expect((error as QueryValidationError).code).toBe("invalid-row-lock")
    expect((error as QueryValidationError).context).toBe("dialect.mysql.row-lock")
  }
})

test("rejects row locking for standard SQL, SQLite, and untyped dialects", () => {
  const query = select({ id: users.id }, from(users), rowLock())

  expect(() => render(query, standardDialect() as unknown as Dialect)).toThrow(
    'Dialect "standard-sql" does not support the "row-locking" capability',
  )
  expect(() => render(query, sqliteDialect() as unknown as Dialect)).toThrow(
    'Dialect "sqlite" does not support the "row-locking" capability',
  )
})

test("reports duplicate and malformed row-lock clauses structurally", () => {
  let duplicate: unknown

  try {
    select({ id: users.id }, from(users), rowLock(), rowLock())
  } catch (error) {
    duplicate = error
  }

  expect(duplicate).toBeInstanceOf(QueryValidationError)
  expect((duplicate as QueryValidationError).code).toBe("duplicate-clause")
  expect((duplicate as QueryValidationError).context).toBe("select.clauses")

  expect(() => rowLock("invalid-mode" as never)).toThrowError(QueryValidationError)
  expect(() => rowLock("update", "invalid-wait" as never)).toThrowError(QueryValidationError)
})
