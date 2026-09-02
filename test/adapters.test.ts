import { DatabaseSync } from "node:sqlite"

import { describe, expect, test, vi } from "vitest"

import { rdsDataApiAdapter as rdsDataApiMysqlAdapter } from "../adapters/aws-rds-data-api/src/mysql.ts"
import { rdsDataApiAdapter as rdsDataApiPostgresAdapter } from "../adapters/aws-rds-data-api/src/postgres.ts"
import { bunSqlAdapter } from "../adapters/bun-sql/src/index.ts"
import { d1Adapter } from "../adapters/cloudflare-d1/src/index.ts"
import { mysql2Adapter } from "../adapters/mysql2/src/index.ts"
import { neonAdapter } from "../adapters/neon/src/index.ts"
import { nodeSqliteAdapter } from "../adapters/node-sqlite/src/index.ts"
import { pgAdapter } from "../adapters/pg/src/index.ts"
import { pgliteAdapter } from "../adapters/pglite/src/index.ts"
import { planetscaleAdapter } from "../adapters/planetscale/src/index.ts"
import { postgresJsAdapter } from "../adapters/postgresjs/src/index.ts"
import { sqliteWasmAdapter } from "../adapters/sqlite-wasm/src/index.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import type { ExecutionRequest } from "../src/execution.ts"
import { eq, executeRows, from, integer, render, select, table, text, where } from "../src/index.ts"

function request(
  queryKind: ExecutionRequest["queryKind"],
  parameters: readonly unknown[] = [42],
  parameterSqlTypes?: ExecutionRequest["statement"]["parameterSqlTypes"],
): ExecutionRequest {
  return {
    statement: {
      text: "SELECT ?",
      parameters,
      ...(parameterSqlTypes === undefined ? {} : { parameterSqlTypes }),
    },
    queryKind,
    resultShape: { fields: [] },
  }
}

describe("workspace adapters", () => {
  test("node:sqlite executes rows and mutation facts", async () => {
    const database = new DatabaseSync(":memory:")

    database.exec("CREATE TABLE records (id INTEGER PRIMARY KEY, name TEXT)")
    const adapter = nodeSqliteAdapter(database)

    try {
      await expect(
        adapter.execute({
          statement: {
            text: "INSERT INTO records (name) VALUES (?)",
            parameters: ["Ada"],
          },
          queryKind: "insert",
          resultShape: { fields: [] },
        }),
      ).resolves.toMatchObject({
        affectedRows: 1,
        insertId: 1,
      })
      const selected = await adapter.execute({
        statement: {
          text: "SELECT name FROM records WHERE id = ?",
          parameters: [1],
        },
        queryKind: "select",
        resultShape: { fields: [] },
      })

      expect(selected).toEqual({ rows: [{ name: "Ada" }] })
      expect(Object.getPrototypeOf(selected.rows[0])).toBe(Object.prototype)
    } finally {
      database.close()
    }
  })

  test("official SQLite WASM finalizes statements and maps bound mutation metadata", async () => {
    const mutationStatement = {
      bind: vi.fn(),
      columnCount: 0,
      finalize: vi.fn(),
      get: vi.fn(),
      step: vi.fn(() => false),
    }
    const selectStatement = {
      bind: vi.fn(),
      columnCount: 2,
      finalize: vi.fn(),
      get: vi.fn((target: Record<string, unknown>) =>
        Object.assign(target, { id: 1, name: "Ada" }),
      ),
      step: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
    }
    const database = {
      changes: vi.fn(() => 1),
      close: vi.fn(),
      prepare: vi.fn().mockReturnValueOnce(mutationStatement).mockReturnValueOnce(selectStatement),
      selectValue: vi.fn(() => 7),
    }
    const adapter = sqliteWasmAdapter(database as never)

    await expect(
      adapter.execute({
        statement: {
          text: "INSERT INTO records (name) VALUES (?)",
          parameters: ["Ada"],
        },
        queryKind: "insert",
        resultShape: { fields: [] },
      }),
    ).resolves.toEqual({
      rows: [],
      affectedRows: 1,
      insertId: 7,
    })
    const selected = await adapter.execute({
      statement: {
        text: "SELECT id, name FROM records WHERE id = ?",
        parameters: [1],
      },
      queryKind: "select",
      resultShape: { fields: [] },
    })

    expect(selected).toEqual({ rows: [{ id: 1, name: "Ada" }] })
    expect(Object.getPrototypeOf(selected.rows[0])).toBe(Object.prototype)
    expect(mutationStatement.bind).toHaveBeenCalledWith(["Ada"])
    expect(selectStatement.bind).toHaveBeenCalledWith([1])
    expect(mutationStatement.finalize).toHaveBeenCalledOnce()
    expect(selectStatement.finalize).toHaveBeenCalledOnce()
    expect(database.selectValue).toHaveBeenCalledWith("SELECT last_insert_rowid()")

    adapter.close()
    adapter.close()
    expect(database.close).toHaveBeenCalledOnce()
  })

  test("official SQLite WASM finalizes a statement when execution fails", async () => {
    const error = new Error("step failed")
    const statement = {
      bind: vi.fn(),
      columnCount: 0,
      finalize: vi.fn(),
      get: vi.fn(),
      step: vi.fn(() => {
        throw error
      }),
    }
    const database = {
      changes: vi.fn(() => 0),
      close: vi.fn(),
      prepare: vi.fn(() => statement),
      selectValue: vi.fn(),
    }

    await expect(sqliteWasmAdapter(database as never).execute(request("update"))).rejects.toBe(
      error,
    )
    expect(statement.finalize).toHaveBeenCalledOnce()
  })

  test("pg normalizes rows and affected row counts", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 1 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 2,
      })
    const adapter = pgAdapter({ query } as never)

    await expect(adapter.execute(request("select"))).resolves.toEqual({
      rows: [{ id: 1 }],
    })
    await expect(adapter.execute(request("update"))).resolves.toEqual({
      rows: [],
      affectedRows: 2,
    })
  })

  test("mysql2 normalizes result headers", async () => {
    const connection = {
      execute: vi.fn(async () => [
        {
          affectedRows: 2,
          changedRows: 1,
          insertId: 7,
        },
        [],
      ]),
    }
    const adapter = mysql2Adapter(connection as never)

    await expect(adapter.execute(request("insert"))).resolves.toEqual({
      rows: [],
      affectedRows: 2,
      changedRows: 1,
      insertId: 7,
    })
  })

  test("Bun.SQL normalizes array metadata with an explicit dialect", async () => {
    const rows = Object.assign([{ id: 1 }], { count: 1 })
    const sql = {
      unsafe: vi.fn(() => Object.assign(Promise.resolve(rows), { cancel: vi.fn() })),
      begin: vi.fn(),
    }

    await expect(
      bunSqlAdapter(sql as never, { dialect: sqliteDialect() }).execute(request("update")),
    ).resolves.toEqual({
      rows: [{ id: 1 }],
      affectedRows: 1,
    })
  })

  test("Bun.SQL requires an explicit dialect", () => {
    const sql = {
      unsafe: vi.fn(),
      begin: vi.fn(),
    }

    expect(() => Reflect.apply(bunSqlAdapter, undefined, [sql])).toThrow(
      "bunSqlAdapter requires an explicit dialect",
    )
  })

  test("Bun.SQL maps insert identifiers without leaking stale metadata", async () => {
    const insertRows = Object.assign([], {
      count: 1,
      lastInsertRowid: 7n,
    })
    const updateRows = Object.assign([], {
      affectedRows: 1,
      lastInsertRowid: 7n,
    })
    const selectRows = Object.assign([{ id: 7 }], {
      count: 1,
      lastInsertRowid: null,
    })
    const unsafe = vi
      .fn()
      .mockReturnValueOnce(Object.assign(Promise.resolve(insertRows), { cancel: vi.fn() }))
      .mockReturnValueOnce(Object.assign(Promise.resolve(updateRows), { cancel: vi.fn() }))
      .mockReturnValueOnce(Object.assign(Promise.resolve(selectRows), { cancel: vi.fn() }))
    const adapter = bunSqlAdapter(
      {
        unsafe,
        begin: vi.fn(),
      } as never,
      {
        dialect: sqliteDialect(),
      },
    )

    await expect(adapter.execute(request("insert"))).resolves.toEqual({
      rows: [],
      affectedRows: 1,
      insertId: 7n,
    })
    await expect(adapter.execute(request("update"))).resolves.toEqual({
      rows: [],
      affectedRows: 1,
    })
    await expect(adapter.execute(request("select"))).resolves.toEqual({ rows: [{ id: 7 }] })
  })

  test("Bun.SQL delegates transaction commit and rollback to Bun", async () => {
    const events: string[] = []
    const query = Object.assign(Promise.resolve([]), { cancel: vi.fn() })
    const transactionClient = {
      unsafe: vi.fn(() => query),
    }
    const begin = vi.fn(
      async (callback: (transaction: typeof transactionClient) => Promise<unknown>) => {
        events.push("begin")
        try {
          const result = await callback(transactionClient)
          events.push("commit")
          return result
        } catch (error) {
          events.push("rollback")
          throw error
        }
      },
    )
    const adapter = bunSqlAdapter(
      {
        unsafe: vi.fn(() => query),
        begin,
      } as never,
      {
        dialect: sqliteDialect(),
      },
    )

    await expect(
      adapter.transaction(async (transaction) => transaction.execute(request("select"))),
    ).resolves.toEqual({ rows: [] })

    const error = new Error("rollback")
    await expect(
      adapter.transaction(async () => {
        throw error
      }),
    ).rejects.toBe(error)
    expect(events).toEqual(["begin", "commit", "begin", "rollback"])
  })

  test("Bun.SQL cancels an in-flight query when its signal aborts", async () => {
    const controller = new AbortController()
    const reason = new Error("query aborted")
    let resolveQuery!: (rows: readonly Record<string, unknown>[]) => void
    const queryPromise = new Promise<readonly Record<string, unknown>[]>((resolve) => {
      resolveQuery = resolve
    })
    const cancel = vi.fn()
    const unsafe = vi.fn(() => Object.assign(queryPromise, { cancel }))
    const adapter = bunSqlAdapter(
      {
        unsafe,
        begin: vi.fn(),
      } as never,
      {
        dialect: sqliteDialect(),
      },
    )

    const pending = adapter.execute({
      ...request("select"),
      signal: controller.signal,
    })

    await Promise.resolve()
    controller.abort(reason)
    expect(cancel).toHaveBeenCalledOnce()

    resolveQuery([])
    await expect(pending).rejects.toBe(reason)
  })

  test("Bun.SQL removes its abort listener after a query settles", async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const rows = Object.assign([], { count: 1 })
    const unsafe = vi.fn(() => Object.assign(Promise.resolve(rows), { cancel }))
    const adapter = bunSqlAdapter(
      {
        unsafe,
        begin: vi.fn(),
      } as never,
      {
        dialect: sqliteDialect(),
      },
    )

    await adapter.execute({
      ...request("select"),
      signal: controller.signal,
    })
    controller.abort()

    expect(cancel).not.toHaveBeenCalled()
  })

  test("postgres.js normalizes row-list metadata", async () => {
    const rows = Object.assign([{ id: 1 }], { count: 3 })
    const sql = Object.assign(vi.fn(), {
      unsafe: vi.fn(async () => rows),
      begin: vi.fn(),
    })

    await expect(postgresJsAdapter(sql as never).execute(request("delete"))).resolves.toEqual({
      rows: [{ id: 1 }],
      affectedRows: 3,
    })
  })

  test("Cloudflare D1 normalizes mutation metadata", async () => {
    const run = vi.fn(async () => ({
      results: [{ id: 4 }],
      meta: {
        changes: 1,
        last_row_id: 4,
      },
    }))
    const prepared = {
      bind: vi.fn(() => prepared),
      run,
      all: vi.fn(),
    }
    const database = { prepare: vi.fn(() => prepared) }

    await expect(d1Adapter(database).execute(request("insert"))).resolves.toEqual({
      rows: [{ id: 4 }],
      affectedRows: 1,
      insertId: 4,
    })
  })

  test("PGlite normalizes PostgreSQL result metadata", async () => {
    const database = {
      query: vi.fn(async () => ({
        rows: [{ id: 1 }],
        rowCount: 2,
        fields: [],
      })),
      transaction: vi.fn(),
    }

    await expect(pgliteAdapter(database as never).execute(request("update"))).resolves.toEqual({
      rows: [{ id: 1 }],
      affectedRows: 2,
    })
  })

  test("Neon HTTP renders PostgreSQL placeholders and normalizes full results", async () => {
    const query = vi.fn(async () => ({
      rows: [{ id: 7 }],
      fields: [],
      command: "SELECT",
      rowCount: 1,
      rowAsArray: false,
    }))
    const adapter = neonAdapter({ query } as never)
    const records = table("records", {
      id: integer(),
      name: text(),
    })
    const read = select(
      {
        id: records.id,
        name: records.name,
      },
      from(records),
      where(eq(records.id, 7)),
    )

    expect(render(read, adapter.dialect)).toEqual({
      text: 'SELECT "records"."id" AS "id", "records"."name" AS "name" FROM "records" WHERE ("records"."id" = $1)',
      parameters: [7],
    })
    await expect(executeRows(read, adapter)).resolves.toEqual([{ id: 7 }])
    expect(query).toHaveBeenCalledWith(
      'SELECT "records"."id" AS "id", "records"."name" AS "name" FROM "records" WHERE ("records"."id" = $1)',
      [7],
      {
        arrayMode: false,
        fullResults: true,
      },
    )
  })

  test("Neon HTTP forwards fetch abort signals and preserves driver errors", async () => {
    const signal = new AbortController().signal
    const error = new Error("neon request failed")
    const query = vi.fn(async () => {
      throw error
    })
    const adapter = neonAdapter({ query } as never)

    await expect(
      adapter.execute({
        ...request("select"),
        signal,
      }),
    ).rejects.toBe(error)
    expect(query).toHaveBeenCalledWith("SELECT ?", [42], {
      arrayMode: false,
      fullResults: true,
      fetchOptions: { signal },
    })
  })

  test("PlanetScale maps serverless mutation metadata and scopes transactions", async () => {
    const execute = vi.fn(async () => ({
      headers: [],
      types: {},
      rows: [{ id: 7 }],
      fields: [],
      size: 1,
      statement: "SELECT ?",
      time: 0,
      rowsAffected: 2,
      insertId: "7",
    }))
    const transactionExecute = vi.fn(async () => ({
      headers: [],
      types: {},
      rows: [],
      fields: [],
      size: 0,
      statement: "SELECT ?",
      time: 0,
      rowsAffected: 0,
      insertId: "0",
    }))
    const transaction = vi.fn(async (callback) =>
      callback({ execute: transactionExecute } as never),
    )
    const adapter = planetscaleAdapter({
      execute,
      transaction,
    } as never)

    await expect(adapter.execute(request("insert"))).resolves.toEqual({
      rows: [{ id: 7 }],
      affectedRows: 2,
      insertId: "7",
    })
    await expect(
      adapter.transaction(async (scoped) => scoped.execute(request("update"))),
    ).resolves.toEqual({
      rows: [],
      affectedRows: 0,
    })
    expect(execute).toHaveBeenCalledWith("SELECT ?", [42])
    expect(transaction).toHaveBeenCalledOnce()
    expect(transactionExecute).toHaveBeenCalledWith("SELECT ?", [42])
  })

  test("RDS Data API renders named parameters and decodes field metadata", async () => {
    const calls: {
      input: Record<string, unknown>
      command: string
    }[] = []
    const client = {
      async send(command: { input: Record<string, unknown> }) {
        calls.push({
          input: command.input,
          command: command.constructor.name,
        })
        if ("sql" in command.input) {
          return {
            records: [[{ longValue: 7 }, { stringValue: "Ada" }]],
            columnMetadata: [{ label: "id" }, { name: "name" }],
            numberOfRecordsUpdated: 1,
            generatedFields: [{ longValue: 7 }],
          }
        }

        return { transactionId: "tx-1" }
      },
    }
    const adapter = rdsDataApiPostgresAdapter(client as never, {
      resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:qubu",
      secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:qubu",
      database: "app",
    })
    const records = table("records", {
      id: integer(),
      name: text(),
    })
    const read = select(
      {
        id: records.id,
        name: records.name,
      },
      from(records),
      where(eq(records.id, 7)),
    )

    expect(render(read, adapter.dialect)).toEqual({
      text: 'SELECT "records"."id" AS "id", "records"."name" AS "name" FROM "records" WHERE ("records"."id" = :p1)',
      parameters: [7],
    })
    await expect(executeRows(read, adapter)).resolves.toEqual([
      {
        id: 7,
        name: "Ada",
      },
    ])
    expect(calls[0]?.input).toMatchObject({
      sql: 'SELECT "records"."id" AS "id", "records"."name" AS "name" FROM "records" WHERE ("records"."id" = :p1)',
      parameters: [
        {
          name: "p1",
          value: { longValue: 7 },
        },
      ],
      includeResultMetadata: true,
      formatRecordsAs: "NONE",
      database: "app",
      resultSetOptions: {
        decimalReturnType: "STRING",
        longReturnType: "STRING",
      },
    })
  })

  test("RDS Data API preserves typed values and transaction IDs", async () => {
    const calls: {
      input: Record<string, unknown>
      command: string
    }[] = []
    const client = {
      async send(command: { input: Record<string, unknown> }) {
        calls.push({
          input: command.input,
          command: command.constructor.name,
        })
        if ("sql" in command.input) {
          return { numberOfRecordsUpdated: 1 }
        }

        return { transactionId: "tx-1" }
      },
    }
    const adapter = rdsDataApiMysqlAdapter(client as never, {
      resourceArn: "resource",
      secretArn: "secret",
    })
    const values = [
      null,
      true,
      7,
      1.5,
      9007199254740993n,
      new Date("2026-08-29T12:30:00.000Z"),
      new Uint8Array([1, 2]),
      { status: "ready" },
    ]

    await expect(adapter.execute(request("update", values))).resolves.toEqual({
      rows: [],
      affectedRows: 1,
    })
    await expect(
      adapter.transaction(async (scoped) => scoped.execute(request("update", [1]))),
    ).resolves.toEqual({
      rows: [],
      affectedRows: 1,
    })

    expect(calls[0]?.input.parameters).toEqual([
      {
        name: "p1",
        value: { isNull: true },
      },
      {
        name: "p2",
        value: { booleanValue: true },
      },
      {
        name: "p3",
        value: { longValue: 7 },
      },
      {
        name: "p4",
        value: { doubleValue: 1.5 },
      },
      {
        name: "p5",
        value: { stringValue: "9007199254740993" },
        typeHint: "DECIMAL",
      },
      {
        name: "p6",
        value: { stringValue: "2026-08-29 12:30:00.000" },
        typeHint: "TIMESTAMP",
      },
      {
        name: "p7",
        value: { blobValue: new Uint8Array([1, 2]) },
      },
      {
        name: "p8",
        value: { stringValue: '{"status":"ready"}' },
        typeHint: "JSON",
      },
    ])
    expect(calls.map(({ input }) => input.transactionId)).toEqual([
      undefined,
      undefined,
      "tx-1",
      "tx-1",
    ])
    expect(calls.map(({ command }) => command)).toEqual([
      "ExecuteStatementCommand",
      "BeginTransactionCommand",
      "ExecuteStatementCommand",
      "CommitTransactionCommand",
    ])
    await expect(adapter.execute(request("update", [Number.MAX_SAFE_INTEGER + 2]))).rejects.toThrow(
      "use a bigint or string",
    )
  })

  test("RDS Data API honors declared parameter SQL domains", async () => {
    const calls: Record<string, unknown>[] = []
    const client = {
      async send(command: { input: Record<string, unknown> }) {
        calls.push(command.input)
        return { numberOfRecordsUpdated: 1 }
      },
    }
    const adapter = rdsDataApiMysqlAdapter(client as never, {
      resourceArn: "resource",
      secretArn: "secret",
    })

    await expect(
      adapter.execute(
        request(
          "update",
          [new Date("2026-08-29T12:30:00.000Z"), "108cb836-20d2-41b2-8c23-f0c94700aa7e", 42.5],
          ["date", "uuid", "decimal"],
        ),
      ),
    ).resolves.toMatchObject({ affectedRows: 1 })

    expect(calls[0]?.parameters).toEqual([
      {
        name: "p1",
        value: { stringValue: "2026-08-29" },
        typeHint: "DATE",
      },
      {
        name: "p2",
        value: { stringValue: "108cb836-20d2-41b2-8c23-f0c94700aa7e" },
        typeHint: "UUID",
      },
      {
        name: "p3",
        value: { stringValue: "42.5" },
        typeHint: "DECIMAL",
      },
    ])
  })
})
