import mysql, { type Connection } from "mysql2/promise"
import { canonicalizeCompleteSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

import {
  baselineAdapter,
  migrate,
  readMigrationSnapshot,
} from "../../adapters/mysql2/src/migration.ts"
import {
  captureBaseline,
  createBaseline,
  preflightBaseline,
} from "../../packages/migrate/src/baseline/index.ts"

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

  test("adopts the reviewed live MySQL schema and migrates it without losing existing rows", async () => {
    await connection.query(
      "CREATE TABLE game (id INT PRIMARY KEY, title VARCHAR(255) NOT NULL DEFAULT 'untitled') COMMENT='Existing games'",
    )
    await connection.query("INSERT INTO game VALUES (1, 'Maze')")
    await connection.query("CREATE TABLE external (id INT PRIMARY KEY)")
    const { snapshot: all } = await readMigrationSnapshot(connection)
    const game = all.tables.find((table) => table.physicalName === "game")!
    const scope: SchemaSnapshot = canonicalizeCompleteSchemaSnapshot({
      ...all,
      comments: [],
      tables: [
        {
          ...game,
          columns: [
            ...game.columns,
            {
              kind: "column",
              id: "manifest",
              physicalName: "manifest",
              ordinalPosition: 3,
              nullable: true,
              hasDefault: false,
              generated: false,
              storage: {
                kind: "native",
                dialect: "mysql",
                type: "json",
              },
            },
          ],
        },
      ],
    })
    const { snapshot: candidate, unmanagedObjects } = await captureBaseline({
      adapter: baselineAdapter(connection),
      scope,
    })

    expect(candidate.tables[0]!.columns.map((column) => column.physicalName)).toEqual([
      "id",
      "title",
    ])
    expect(unmanagedObjects).toEqual([
      {
        kind: "table",
        physicalName: "external",
      },
    ])
    const input = {
      scope,
      candidate,
      repository: [],
    }

    await preflightBaseline({
      adapter: baselineAdapter(connection),
      ...input,
    })
    await connection.query("ALTER TABLE game ADD changed INT")
    await expect(
      preflightBaseline({
        adapter: baselineAdapter(connection),
        ...input,
      }),
    ).rejects.toMatchObject({ code: "drift" })
    await connection.query("ALTER TABLE game DROP changed")
    const { artifact } = await createBaseline({
      adapter: baselineAdapter(connection),
      ...input,
      id: "initial",
      provenance: { source: "mysql-adoption-test" },
      confirmation: {
        databaseTargetVerified: true,
        snapshotSourceVerified: true,
        zeroManagedDriftVerified: true,
        backupRestoreReady: true,
        otherMigratorsStopped: true,
        incompatibleApplicationPrevented: true,
        legacyHistoryCutoverAccepted: true,
      },
    })

    expect(artifact.sequence).toBe(0)
    expect(artifact).not.toHaveProperty("program")
    const [before] = await connection.query("SELECT * FROM game")

    expect(before).toEqual([
      {
        id: 1,
        title: "Maze",
      },
    ])
    const migrations = [
      {
        id: "add-manifest",
        sql: ["ALTER TABLE game ADD manifest JSON"],
      },
    ]

    expect(await migrate(connection, migrations)).toEqual({ applied: ["add-manifest"] })
    expect(await migrate(connection, migrations)).toEqual({ applied: [] })
    const [after] = await connection.query("SELECT * FROM game")

    expect(after).toEqual([
      {
        id: 1,
        title: "Maze",
        manifest: null,
      },
    ])
    const [history] = await connection.query(
      "SELECT baseline FROM __qubu_mysql2_migrations WHERE id = 'initial'",
    )

    expect(JSON.parse((history as { baseline: string }[])[0]!.baseline)).toEqual(artifact)
  })
})
