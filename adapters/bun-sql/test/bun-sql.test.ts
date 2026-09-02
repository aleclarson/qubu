import { afterAll, beforeEach, expect, test } from "bun:test"

import { SQL } from "bun"
import type { ExecutionRequest } from "qubu"
import { sqliteDialect } from "qubu/sqlite"

import { bunSqlAdapter } from "../src/index.ts"

const sql = new SQL(":memory:")
const adapter = bunSqlAdapter(sql, { dialect: sqliteDialect() })

function request(
  text: string,
  queryKind: ExecutionRequest["queryKind"],
  parameters: readonly unknown[] = [],
): ExecutionRequest {
  return {
    statement: {
      text,
      parameters,
    },
    queryKind,
    resultShape: { fields: [] },
  }
}

beforeEach(async () => {
  await sql.unsafe("DROP TABLE IF EXISTS bun_sql_records")
  await sql.unsafe(
    "CREATE TABLE bun_sql_records (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)",
  )
})

afterAll(async () => {
  await sql.close()
})

test("round-trips a SQLite insert and select through Bun SQL", async () => {
  await expect(
    adapter.execute(request("INSERT INTO bun_sql_records (name) VALUES (?)", "insert", ["Ada"])),
  ).resolves.toEqual({
    rows: [],
    affectedRows: 1,
    insertId: 1,
  })

  await expect(
    adapter.execute(
      request("SELECT id, name FROM bun_sql_records WHERE name = ?", "select", ["Ada"]),
    ),
  ).resolves.toEqual({
    rows: [
      {
        id: 1,
        name: "Ada",
      },
    ],
  })
})

test("commits successful Bun SQL transactions and rolls back failures", async () => {
  await adapter.transaction(async (transaction) => {
    await transaction.execute(
      request("INSERT INTO bun_sql_records (name) VALUES (?)", "insert", ["Ada"]),
    )
  })

  await expect(
    adapter.execute(request("SELECT name FROM bun_sql_records", "select")),
  ).resolves.toEqual({ rows: [{ name: "Ada" }] })

  const error = new Error("rollback")

  await expect(
    adapter.transaction(async (transaction) => {
      await transaction.execute(
        request("INSERT INTO bun_sql_records (name) VALUES (?)", "insert", ["Grace"]),
      )
      throw error
    }),
  ).rejects.toBe(error)

  await expect(
    adapter.execute(request("SELECT name FROM bun_sql_records", "select")),
  ).resolves.toEqual({ rows: [{ name: "Ada" }] })
})
