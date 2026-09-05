import { readFileSync } from "node:fs"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"

import { afterEach, expect, test } from "vitest"

import { nodeSqliteAdapter } from "../adapters/node-sqlite/src/index.ts"
import {
  boolean,
  date,
  execute,
  executeRows,
  explain,
  from,
  insertInto,
  integer,
  json,
  returning,
  select,
  table,
  timestamp,
  values,
} from "../src/index.ts"
import type { DriverValueEncoder, ExecutionRequest } from "../src/index.ts"

const databases: DatabaseSync[] = []
const records = table("records", {
  id: integer(),
  active: boolean(),
  occurredOn: date(),
  recordedAt: timestamp(),
  metadata: json<{ kind: string }>(),
})

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.isOpen) {
      database.close()
    }
  }
})

function createDatabase(returnArrays = false): DatabaseSync {
  const database = new DatabaseSync(":memory:", { returnArrays })
  databases.push(database)
  database.exec(
    `
      CREATE TABLE records (
        id INTEGER NOT NULL,
        active INTEGER NOT NULL,
        occurred_on TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        metadata TEXT NOT NULL
      )
    `,
  )
  return database
}

function request(
  text: string,
  parameters: readonly unknown[],
  parameterSqlTypes?: ExecutionRequest["statement"]["parameterSqlTypes"],
): ExecutionRequest {
  return {
    statement: {
      text,
      parameters,
      ...(parameterSqlTypes === undefined ? {} : { parameterSqlTypes }),
    },
    queryKind: "select",
    resultShape: { fields: [] },
  }
}

function transactionDatabase(commitError?: unknown, rollbackError?: unknown): DatabaseSync {
  let active = false

  return {
    get isTransaction() {
      return active
    },
    exec(sql: string) {
      if (sql.startsWith("BEGIN")) {
        active = true
        return
      }
      if (sql === "COMMIT") {
        if (commitError !== undefined) {
          throw commitError
        }
        active = false
        return
      }
      if (sql === "ROLLBACK") {
        if (rollbackError !== undefined) {
          throw rollbackError
        }
        active = false
      }
    },
  } as unknown as DatabaseSync
}

test("binds portable SQLite domains and decodes aliased rows from array-configured databases", async () => {
  const database = createDatabase(true)
  const adapter = nodeSqliteAdapter(database)
  const recordedAt = new Date("2026-08-27T14:30:00.000Z")

  const inserted = await execute(
    insertInto(
      records,
      values({
        id: 1,
        active: true,
        occurredOn: new Date("2026-08-27T14:30:00.000Z"),
        recordedAt,
        metadata: { kind: "created" },
      }),
    ),
    adapter,
  )

  expect(inserted).toEqual({ rows: [], affectedRows: 1 })

  const query = select(
    {
      enabled: records.active,
      occurred: records.occurredOn,
      recorded: records.recordedAt,
      details: records.metadata,
    },
    from(records),
  )

  await expect(executeRows(query, adapter)).resolves.toEqual([
    {
      enabled: true,
      occurred: new Date("2026-08-27T00:00:00.000Z"),
      recorded: recordedAt,
      details: { kind: "created" },
    },
  ])

  const plan = await explain(query, adapter)
  expect(plan.rows.length).toBeGreaterThan(0)
  expect(Array.isArray(plan.rows[0])).toBe(false)
  expect(Object.getPrototypeOf(plan.rows[0])).toBe(Object.prototype)
  expect(adapter.decoders).toMatchObject({
    boolean: expect.any(Function),
    date: expect.any(Function),
    json: expect.any(Function),
    timestamp: expect.any(Function),
  })
  expect(adapter.decoders).not.toHaveProperty("bigint")
})

test("keeps returned rows as the reliable insert identifier path", async () => {
  const adapter = nodeSqliteAdapter(createDatabase(true))
  const result = await execute(
    insertInto(
      records,
      values({
        id: 7,
        active: false,
        occurredOn: new Date("2026-08-27T00:00:00.000Z"),
        recordedAt: new Date("2026-08-27T14:30:00.000Z"),
        metadata: { kind: "returned" },
      }),
      returning({ generatedId: records.id }),
    ),
    adapter,
  )

  expect(result).toEqual({ rows: [{ generatedId: 7 }] })
  expect(result).not.toHaveProperty("insertId")
})

test("lets a custom encoder replace SQLite defaults while preserving parameter domains", async () => {
  const database = createDatabase(true)
  const calls: Array<{ readonly value: unknown; readonly sqlType: string | undefined }> = []
  const encoder: DriverValueEncoder<SQLInputValue> = {
    encode(value, sqlType) {
      calls.push({ value, sqlType })

      if (typeof value === "boolean") {
        return value ? 1 : 0
      }

      if (value instanceof Date) {
        return value.toISOString()
      }

      if (typeof value === "object" && value !== null) {
        return JSON.stringify(value)
      }

      return value as SQLInputValue
    },
  }
  const adapter = nodeSqliteAdapter(database, { encoder })
  const recordedAt = new Date("2026-08-27T14:30:00.000Z")
  const metadata = { kind: "custom" }
  const statement = {
    text: "SELECT ? AS enabled, ? AS recordedAt, ? AS metadata, ? AS empty",
    parameters: [true, recordedAt, metadata, null],
    parameterSqlTypes: ["boolean", "timestamp", "custom", undefined] as const,
  }

  await expect(
    adapter.execute({
      ...request(statement.text, statement.parameters, statement.parameterSqlTypes),
    }),
  ).resolves.toEqual({
    rows: [
      {
        enabled: 1,
        recordedAt: recordedAt.toISOString(),
        metadata: JSON.stringify(metadata),
        empty: null,
      },
    ],
  })

  await expect(
    adapter.explain({
      ...request(`EXPLAIN ${statement.text}`, statement.parameters, statement.parameterSqlTypes),
    }),
  ).resolves.toMatchObject({ rows: expect.any(Array) })

  expect(calls).toEqual([
    { value: true, sqlType: "boolean" },
    { value: recordedAt, sqlType: "timestamp" },
    { value: metadata, sqlType: "custom" },
    { value: null, sqlType: undefined },
    { value: true, sqlType: "boolean" },
    { value: recordedAt, sqlType: "timestamp" },
    { value: metadata, sqlType: "custom" },
    { value: null, sqlType: undefined },
  ])
})

test("preserves null, scalar, and binary SQLite parameters", async () => {
  const adapter = nodeSqliteAdapter(createDatabase())
  const binary = new Uint8Array([1, 2, 3])

  const result = await adapter.execute(
    request("SELECT ? AS empty, ? AS number, ? AS text, ? AS binary", [null, 7, "value", binary]),
  )

  expect(result.rows[0]).toMatchObject({ empty: null, number: 7, text: "value" })
  expect([...new Uint8Array(result.rows[0]?.binary as Uint8Array)]).toEqual([1, 2, 3])
})

test("rejects untyped objects before passing them to node:sqlite", async () => {
  const adapter = nodeSqliteAdapter(createDatabase())

  await expect(
    adapter.execute(request("SELECT ? AS value", [{ unsupported: true }])),
  ).rejects.toThrow(
    "node:sqlite parameters must be null, number, bigint, string, or an ArrayBuffer view",
  )
})

test("declares the node:sqlite execution API floor", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../adapters/node-sqlite/package.json", import.meta.url), "utf8"),
  ) as { readonly engines?: { readonly node?: string } }

  expect(manifest.engines?.node).toBe(">=22.16.0")
})

test("preserves a callback failure when rollback cleanup also fails", async () => {
  const primary = new Error("callback failed")
  const rollback = new Error("rollback failed")
  const adapter = nodeSqliteAdapter(transactionDatabase(undefined, rollback))

  let failure: unknown
  try {
    await adapter.transaction(async () => {
      throw primary
    })
  } catch (error) {
    failure = error
  }

  expect(failure).toBeInstanceOf(AggregateError)
  expect((failure as AggregateError).errors).toEqual([primary, rollback])
  expect((failure as Error & { readonly cause?: unknown }).cause).toBe(primary)
})

test("preserves a commit failure when rollback cleanup also fails", async () => {
  const commit = new Error("commit failed")
  const rollback = new Error("rollback failed")
  const adapter = nodeSqliteAdapter(transactionDatabase(commit, rollback))

  let failure: unknown
  try {
    await adapter.transaction(async () => "result")
  } catch (error) {
    failure = error
  }

  expect(failure).toBeInstanceOf(AggregateError)
  expect((failure as AggregateError).errors).toEqual([commit, rollback])
  expect((failure as Error & { readonly cause?: unknown }).cause).toBe(commit)
})
