import { expect, test } from "vitest"

import { mysqlDialect } from "../src/dialects/mysql.ts"
import { postgresDialect } from "../src/dialects/postgres.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import {
  deleteFrom,
  eq,
  insertInto,
  integer,
  render,
  returning,
  table,
  text,
  update,
  values,
  where,
  type Dialect,
} from "../src/index.ts"

const records = table("records", {
  id: integer(),
  name: text(),
})
const cases = [
  {
    kind: "insert",
    query: insertInto(
      records,
      values({
        id: 1,
        name: "Ada",
      }),
      returning({ id: records.id }),
    ),
    plain: insertInto(
      records,
      values({
        id: 1,
        name: "Ada",
      }),
    ),
  },
  {
    kind: "update",
    query: update(
      records,
      { name: "Grace" },
      where(eq(records.id, 1)),
      returning({ id: records.id }),
    ),
    plain: update(records, { name: "Grace" }, where(eq(records.id, 1))),
  },
  {
    kind: "delete",
    query: deleteFrom(records, where(eq(records.id, 1)), returning({ id: records.id })),
    plain: deleteFrom(records, where(eq(records.id, 1))),
  },
] as const

test.each(cases)("rejects unsupported MySQL $kind RETURNING before execution", ({ query }) => {
  // Exercise the runtime guard even if the typed boundary also rejects this dialect.
  const dialect: Dialect = mysqlDialect()

  // None of MySQL 8.4's INSERT, UPDATE, or DELETE grammars includes RETURNING:
  // https://dev.mysql.com/doc/refman/8.4/en/insert.html
  // https://dev.mysql.com/doc/refman/8.4/en/update.html
  // https://dev.mysql.com/doc/refman/8.4/en/delete.html
  expect(() => render(query, dialect)).toThrowError(/returning/iu)
})

test.each(cases)("retains PostgreSQL and SQLite $kind RETURNING", ({ query }) => {
  for (const dialect of [postgresDialect(), sqliteDialect()]) {
    expect(render(query, dialect).text).toContain('RETURNING "records"."id" AS "id"')
  }
})

test.each(cases)("keeps plain MySQL $kind renderable", ({ kind, plain }) => {
  const statement = render(plain, mysqlDialect())

  expect(statement.text).toMatch(new RegExp(`^${kind}\\b`, "iu"))
  expect(statement.text).not.toMatch(/\bRETURNING\b/iu)
})
