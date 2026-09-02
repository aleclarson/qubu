import mysql, { type Connection } from "mysql2/promise"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"

import { mysql2Adapter } from "../../adapters/mysql2/src/index.ts"
import {
  boolean,
  eq,
  execute,
  executeRows,
  from,
  insertInto,
  integer,
  select,
  table,
  text,
  update,
  values,
  where,
} from "../../src/index.ts"

const tableName = "qubu_mysql2_adapter_e2e"
const dropSql = `DROP TABLE IF EXISTS ${tableName}`
const schemaSql = `
  CREATE TABLE ${tableName} (
    id INTEGER PRIMARY KEY,
    active BOOLEAN NOT NULL,
    label VARCHAR(255)
  )
`

const records = table(tableName, {
  id: integer(),
  active: boolean(),
  label: text({ nullable: true }),
})

describe.skipIf(process.env.QUBU_E2E_DIALECT !== "mysql")("mysql2 adapter live E2E", () => {
  let connection: Connection | undefined
  let adapter: ReturnType<typeof mysql2Adapter> | undefined

  beforeAll(async () => {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST ?? "127.0.0.1",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? "root",
      password: process.env.MYSQL_PASSWORD ?? "root",
      database: process.env.MYSQL_DATABASE ?? "qubu",
    })
    await connection.query(dropSql)
    await connection.query(schemaSql)
    adapter = mysql2Adapter(connection)
  }, 30_000)

  beforeEach(async () => {
    if (!connection) {
      throw new Error("MySQL environment was not initialized")
    }

    await connection.query(`DELETE FROM ${tableName}`)
  })

  afterAll(async () => {
    if (!connection) {
      return
    }

    try {
      await connection.query(dropSql)
    } finally {
      await connection.end()
    }
  }, 30_000)

  test("round trips booleans and explicit undefined as SQL NULL", async () => {
    if (!adapter) {
      throw new Error("MySQL adapter was not initialized")
    }

    await execute(
      insertInto(
        records,
        values({
          id: 1,
          active: true,
          label: "Ada",
        }),
      ),
      adapter,
    )

    const read = select(
      {
        id: records.id,
        enabled: records.active,
        label: records.label,
      },
      from(records),
      where(eq(records.id, 1)),
    )

    await expect(executeRows(read, adapter)).resolves.toEqual([
      {
        id: 1,
        enabled: true,
        label: "Ada",
      },
    ])

    await execute(update(records, { label: undefined }, where(eq(records.id, 1))), adapter)

    await expect(executeRows(read, adapter)).resolves.toEqual([
      {
        id: 1,
        enabled: true,
        label: null,
      },
    ])
  }, 30_000)
})
