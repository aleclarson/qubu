import { expect, test, vi } from "vitest"

import type { Mysql2Connection } from "../adapters/mysql2/src/index.ts"
import { migrate } from "../adapters/mysql2/src/migration.ts"

function fixture() {
  const history: unknown[][] = []
  const statements: string[] = []
  let fail: string | undefined
  const execute = vi.fn<Mysql2Connection["execute"]>(async ({ sql, values }) => {
    if (sql === fail) {
      throw new Error("driver failure")
    }

    if (sql.startsWith("SELECT id")) {
      return [history.map(([id]) => ({ id })), []]
    }

    if (sql.startsWith("INSERT INTO __qubu_mysql2_migrations")) {
      history.push(values)
    } else if (!sql.startsWith("CREATE TABLE IF NOT EXISTS __qubu_mysql2_migrations")) {
      statements.push(sql)
    }

    return [{ affectedRows: 1 }, []]
  })

  return {
    connection: { execute },
    history,
    statements,
    failAt: (sql: string) => {
      fail = sql
    },
  }
}

test("runs migrations in supplied order and skips completed IDs on subsequent runs", async () => {
  const { connection, history, statements } = fixture()
  const migrations = [
    {
      id: "z-first",
      sql: ["CREATE TABLE accounts (id INT)", "INSERT INTO accounts VALUES (1)"],
    },
    {
      id: "a-second",
      sql: ["ALTER TABLE accounts ADD name TEXT"],
    },
  ]

  expect(await migrate(connection, migrations)).toEqual({ applied: ["z-first", "a-second"] })
  expect(statements).toEqual(migrations.flatMap((migration) => migration.sql))
  expect(history).toEqual([
    ["z-first", expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(Number)],
    ["a-second", expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(Number)],
  ])
  expect(await migrate(connection, migrations)).toEqual({ applied: [] })
  expect(statements).toHaveLength(3)
  expect(
    await migrate(connection, [
      ...migrations,
      {
        id: "third",
        sql: ["SELECT 1"],
      },
    ]),
  ).toEqual({ applied: ["third"] })
  expect(history).toHaveLength(3)
})

test("stops on SQL failure without recording the partial migration or running later migrations", async () => {
  const { connection, history, statements, failAt } = fixture()

  failAt("FAIL")
  await expect(
    migrate(connection, [
      {
        id: "completed",
        sql: ["SELECT 1"],
      },
      {
        id: "partial",
        sql: ["CREATE TABLE accounts (id INT)", "FAIL", "SELECT 2"],
      },
      {
        id: "later",
        sql: ["SELECT 3"],
      },
    ]),
  ).rejects.toThrow("driver failure")
  expect(history.map(([id]) => id)).toEqual(["completed"])
  expect(statements).toEqual(["SELECT 1", "CREATE TABLE accounts (id INT)"])
})

test("stops on a history write failure even when migration SQL succeeded", async () => {
  const { connection, history, statements, failAt } = fixture()

  failAt("INSERT INTO __qubu_mysql2_migrations (id, hash, created_at) VALUES (?, ?, ?)")
  await expect(
    migrate(connection, [
      {
        id: "unrecorded",
        sql: ["CREATE TABLE accounts (id INT)"],
      },
      {
        id: "later",
        sql: ["SELECT 1"],
      },
    ]),
  ).rejects.toThrow("driver failure")
  expect(statements).toEqual(["CREATE TABLE accounts (id INT)"])
  expect(history).toEqual([])
})

test.each([
  [
    {
      id: "same",
      sql: [],
    },
    {
      id: "same",
      sql: [],
    },
  ],
  [
    {
      id: "",
      sql: [],
    },
  ],
  [
    {
      id: "trailing ",
      sql: [],
    },
  ],
  [
    {
      id: "x".repeat(256),
      sql: [],
    },
  ],
  [
    {
      id: "empty-statement",
      sql: [" "],
    },
  ],
])("rejects invalid migrations before making database calls: %j", async (...migrations) => {
  const { connection } = fixture()

  await expect(migrate(connection, migrations)).rejects.toThrow(TypeError)
  expect(connection.execute).not.toHaveBeenCalled()
})

test("binds migration IDs as values and records an empty migration", async () => {
  const { connection, history } = fixture()
  const id = "it's an empty migration"

  expect(
    await migrate(connection, [
      {
        id,
        sql: [],
      },
    ]),
  ).toEqual({ applied: [id] })
  expect(history[0]?.[0]).toBe(id)
  expect(connection.execute.mock.calls.every(([options]) => !options.sql.includes(id))).toBe(true)
})

test("rejects malformed history instead of treating migrations as pending", async () => {
  const execute = vi
    .fn<Mysql2Connection["execute"]>()
    .mockResolvedValueOnce([{ affectedRows: 0 }, []])
    .mockResolvedValueOnce([[{ id: 1 }], []])

  await expect(
    migrate({ execute }, [
      {
        id: "first",
        sql: ["SELECT 1"],
      },
    ]),
  ).rejects.toThrow("invalid ID")
  expect(execute).toHaveBeenCalledTimes(2)
})
