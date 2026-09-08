import mysql, { type Connection } from "mysql2/promise"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

import { migrate } from "../../adapters/mysql2/src/migration.ts"

describe.skipIf(process.env.QUBU_E2E_DIALECT !== "mysql")("mysql2 SQL migrations", () => {
  let connection: Connection
  let database: string

  beforeEach(async () => {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST ?? "127.0.0.1",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? "root",
      password: process.env.MYSQL_PASSWORD ?? "root",
    })
    database = `qubu_migration_${crypto.randomUUID().replaceAll("-", "")}`
    await connection.query(`CREATE DATABASE \`${database}\``)
    await connection.query(`USE \`${database}\``)
  }, 30_000)

  afterEach(async () => {
    if (!connection) {
      return
    }

    try {
      if (database) {
        await connection.query(`DROP DATABASE \`${database}\``)
      }
    } finally {
      await connection.end()
    }
  })

  test("applies later migrations while preserving rows and skips completed migrations", async () => {
    const initial = {
      id: "001-accounts",
      sql: ["CREATE TABLE accounts (id INT PRIMARY KEY)", "INSERT INTO accounts VALUES (1)"],
    }

    expect(await migrate(connection, [initial])).toEqual({ applied: [initial.id] })
    const migrations = [
      initial,
      {
        id: "002-name",
        sql: ["ALTER TABLE accounts ADD name VARCHAR(255) DEFAULT 'Ada'"],
      },
    ]

    expect(await migrate(connection, migrations)).toEqual({ applied: ["002-name"] })
    expect(await migrate(connection, migrations)).toEqual({ applied: [] })
    const [rows] = await connection.query("SELECT * FROM accounts")

    expect(rows).toEqual([
      {
        id: 1,
        name: "Ada",
      },
    ])
    const [history] = await connection.query("SELECT id FROM __qubu_mysql2_migrations ORDER BY id")

    expect(history).toEqual([{ id: "001-accounts" }, { id: "002-name" }])
  })

  test("leaves partial DDL unrecorded and stops before subsequent migrations", async () => {
    await expect(
      migrate(connection, [
        {
          id: "partial",
          sql: [
            "CREATE TABLE accounts (id INT PRIMARY KEY)",
            "INSERT INTO missing_table VALUES (1)",
          ],
        },
        {
          id: "later",
          sql: ["CREATE TABLE later (id INT)"],
        },
      ]),
    ).rejects.toThrow()
    // This table survived the failure, but Qubu did not record the migration as complete.
    const [rows] = await connection.query("SELECT * FROM accounts")

    expect(rows).toEqual([])
    const [history] = await connection.query("SELECT id FROM __qubu_mysql2_migrations")

    expect(history).toEqual([])
    const [tables] = await connection.query("SHOW TABLES LIKE 'later'")

    expect(tables).toEqual([])
  })
})
