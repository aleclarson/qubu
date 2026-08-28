import { DatabaseSync, type SQLInputValue } from "node:sqlite"

import mysql from "mysql2/promise"
import { Client } from "pg"
import { qubu, type DriverValueEncoder, type QubuTransactionalClient } from "qubu"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"

import { qubuAdapter } from "../../adapters/better-auth/src/index.ts"
import { mysql2Adapter } from "../../adapters/mysql2/src/index.ts"
import { nodeSqliteAdapter } from "../../adapters/node-sqlite/src/index.ts"
import { pgAdapter } from "../../adapters/pg/src/index.ts"

const liveDialects = ["postgresql", "sqlite", "mysql"] as const

type LiveDialect = (typeof liveDialects)[number]

const configuredDialect = process.env.QUBU_E2E_DIALECT

if (
  configuredDialect !== undefined &&
  !(liveDialects as readonly string[]).includes(configuredDialect)
) {
  throw new Error(`QUBU_E2E_DIALECT must be one of ${liveDialects.join(", ")}`)
}

const selectedDialect = configuredDialect as LiveDialect | undefined

const tableName = "qubu_better_auth_e2e_user"
const dropSql = `DROP TABLE IF EXISTS ${tableName}`
const schemaSql: Record<LiveDialect, string> = {
  postgresql: `
    CREATE TABLE ${tableName} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      "emailVerified" BOOLEAN NOT NULL,
      image TEXT,
      "createdAt" TIMESTAMP NOT NULL,
      "updatedAt" TIMESTAMP NOT NULL,
      remaining INTEGER NOT NULL
    )
  `,
  mysql: `
    CREATE TABLE ${tableName} (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      emailVerified BOOLEAN NOT NULL,
      image VARCHAR(255),
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      remaining INTEGER NOT NULL
    )
  `,
  sqlite: `
    CREATE TABLE ${tableName} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL,
      image TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      remaining INTEGER NOT NULL
    )
  `,
}

interface LiveEnvironment {
  readonly client: QubuTransactionalClient
  exec(sql: string): Promise<void>
  close(): Promise<void>
}

function encodeValue(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0
  }

  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value)
  }

  return value
}

const encoder: DriverValueEncoder = { encode: encodeValue }
const sqliteEncoder: DriverValueEncoder<SQLInputValue> = {
  encode: (value) => encodeValue(value) as SQLInputValue,
}

async function createEnvironment(dialect: LiveDialect): Promise<LiveEnvironment> {
  if (dialect === "postgresql") {
    const connection = new Client({
      connectionString:
        process.env.POSTGRES_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/qubu",
    })

    await connection.connect()
    return {
      client: qubu(pgAdapter(connection, { encoder })),
      async exec(sql) {
        await connection.query(sql)
      },
      async close() {
        await connection.end()
      },
    }
  }

  if (dialect === "mysql") {
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST ?? "127.0.0.1",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? "root",
      password: process.env.MYSQL_PASSWORD ?? "root",
      database: process.env.MYSQL_DATABASE ?? "qubu",
    })

    return {
      client: qubu(mysql2Adapter(connection)),
      async exec(sql) {
        await connection.query(sql)
      },
      async close() {
        await connection.end()
      },
    }
  }

  const database = new DatabaseSync(":memory:")

  return {
    client: qubu(nodeSqliteAdapter(database, { encoder: sqliteEncoder })),
    async exec(sql) {
      database.exec(sql)
    },
    async close() {
      database.close()
    },
  }
}

describe.skipIf(!selectedDialect)("Better Auth live dialect E2E", () => {
  const dialect = selectedDialect as LiveDialect
  let environment: LiveEnvironment | undefined

  beforeAll(async () => {
    environment = await createEnvironment(dialect)
    await environment.exec(dropSql)
    await environment.exec(schemaSql[dialect])
  }, 30_000)

  beforeEach(async () => {
    await environment?.exec(`DELETE FROM ${tableName}`)
  })

  afterAll(async () => {
    if (!environment) {
      return
    }

    await environment.exec(dropSql)
    await environment.close()
  }, 30_000)

  test("executes guarded increment and single-use consume through the live driver", async () => {
    if (!environment) {
      throw new Error("E2E environment was not initialized")
    }

    const database = qubuAdapter(environment.client)({
      user: {
        modelName: tableName,
        additionalFields: {
          remaining: {
            type: "number",
            required: true,
          },
        },
      },
    })
    const now = new Date("2026-08-28T12:00:00.000Z")

    await database.create({
      model: "user",
      forceAllowId: true,
      data: {
        id: "u1",
        name: "Ada",
        email: "ada@example.com",
        emailVerified: false,
        image: null,
        createdAt: now,
        updatedAt: now,
        remaining: 1,
      },
    })

    const first = await database.incrementOne<{ remaining: number }>({
      model: "user",
      where: [
        {
          field: "id",
          value: "u1",
        },
        {
          field: "remaining",
          operator: "gt",
          value: 0,
        },
      ],
      increment: { remaining: -1 },
    })
    const guarded = await database.incrementOne({
      model: "user",
      where: [
        {
          field: "id",
          value: "u1",
        },
        {
          field: "remaining",
          operator: "gt",
          value: 0,
        },
      ],
      increment: { remaining: -1 },
    })
    const consumed = await database.consumeOne<{ id: string }>({
      model: "user",
      where: [
        {
          field: "id",
          value: "u1",
        },
      ],
    })
    const consumedAgain = await database.consumeOne({
      model: "user",
      where: [
        {
          field: "id",
          value: "u1",
        },
      ],
    })

    expect(first?.remaining).toBe(0)
    expect(guarded).toBeNull()
    expect(consumed?.id).toBe("u1")
    expect(consumedAgain).toBeNull()
  }, 30_000)
})
