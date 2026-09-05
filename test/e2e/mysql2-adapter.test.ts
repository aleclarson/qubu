import mysql, { type Connection } from "mysql2/promise"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"

import { mysql2Adapter } from "../../adapters/mysql2/src/index.ts"
import { incoming, onDuplicateKeyUpdate } from "../../src/dialects/mysql.ts"
import {
  boolean,
  eq,
  execute,
  executeRows,
  from,
  insertInto,
  insertSelect,
  defaultValues,
  integer,
  select,
  table,
  text,
  update,
  values,
  value,
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

  test("executes duplicate-key updates with incoming VALUES and SELECT rows", async () => {
    if (!adapter) {
      throw new Error("MySQL adapter was not initialized")
    }

    const proposed = incoming(records)
    const write = (label: string) =>
      insertInto(
        records,
        values({
          id: 1,
          active: true,
          label,
        }),
        onDuplicateKeyUpdate(records, {
          label: proposed.label,
          active: false,
        }),
      )
    const inserted = await execute(write("Ada"), adapter)

    expect(inserted.rows).toEqual([])
    expect(inserted.affectedRows).toBe(1)
    const updated = await execute(write("Grace"), adapter)

    expect(updated.rows).toEqual([])
    expect(updated.affectedRows).toBe(2)
    expect(updated.insertId).toBeDefined()
    await expect(
      executeRows(
        select(
          {
            label: records.label,
            active: records.active,
          },
          from(records),
        ),
        adapter,
      ),
    ).resolves.toEqual([
      {
        label: "Grace",
        active: false,
      },
    ])
    await execute(
      insertInto(
        records,
        insertSelect(
          select(
            {
              key: records.id,
              enabled: records.active,
              renamed: value("Lin"),
            },
            from(records),
          ),
          ["id", "active", "label"],
        ),
        onDuplicateKeyUpdate(records, { label: proposed.label }),
      ),
      adapter,
    )
    await expect(
      executeRows(select({ label: records.label }, from(records)), adapter),
    ).resolves.toEqual([{ label: "Lin" }])
  }, 30_000)

  test("executes duplicate-key updates for a default row", async () => {
    if (!adapter || !connection) {
      throw new Error("MySQL adapter was not initialized")
    }

    const defaults = table("qubu_mysql_upsert_defaults", {
      id: integer({ hasDefault: true }),
      label: text({ hasDefault: true }),
    })

    await connection.query(
      "CREATE TABLE qubu_mysql_upsert_defaults (id INTEGER PRIMARY KEY DEFAULT 1, label VARCHAR(255) NOT NULL DEFAULT 'initial')",
    )
    try {
      const write = insertInto(
        defaults,
        defaultValues(),
        onDuplicateKeyUpdate(defaults, { label: incoming(defaults).label }),
      )

      await execute(write, adapter)
      await execute(update(defaults, { label: "changed" }, where(eq(defaults.id, 1))), adapter)
      await execute(write, adapter)
      await expect(
        executeRows(select({ label: defaults.label }, from(defaults)), adapter),
      ).resolves.toEqual([{ label: "initial" }])
    } finally {
      await connection.query("DROP TABLE qubu_mysql_upsert_defaults")
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
