import {
  createClient,
  type Client,
  type ResultSet,
  type Row,
  type Transaction,
} from "@libsql/client"
import { describe, expect, test, vi } from "vitest"

import { libsqlAdapter } from "../adapters/libsql/src/index.ts"
import type { ExecutionRequest } from "../src/execution.ts"
import {
  boolean,
  date,
  eq,
  execute,
  executeRows,
  from,
  insertInto,
  integer,
  json,
  select,
  table,
  text,
  timestamp,
  values,
  where,
} from "../src/index.ts"

function result(overrides: Partial<ResultSet> = {}): ResultSet {
  return {
    columns: [],
    columnTypes: [],
    rows: [],
    rowsAffected: 0,
    lastInsertRowid: undefined,
    toJSON() {
      return this
    },
    ...overrides,
  }
}

function request(queryKind: ExecutionRequest["queryKind"], signal?: AbortSignal): ExecutionRequest {
  return {
    statement: {
      text: "SELECT ?",
      parameters: [42],
    },
    queryKind,
    resultShape: { fields: [] },
    ...(signal === undefined ? {} : { signal }),
  }
}

describe("libsqlAdapter", () => {
  test("executes a bound query through the real local client", async () => {
    const client = createClient({ url: "file::memory:" })
    const records = table("qubu_libsql_records", {
      id: integer(),
      name: text(),
    })

    try {
      await client.execute(
        "CREATE TABLE qubu_libsql_records (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
      )
      const adapter = libsqlAdapter(client)
      const inserted = await execute(
        insertInto(
          records,
          values({
            id: 1,
            name: "Ada",
          }),
        ),
        adapter,
      )
      const rows = await executeRows(
        select(
          {
            id: records.id,
            name: records.name,
          },
          from(records),
          where(eq(records.id, 1)),
        ),
        adapter,
      )

      expect(inserted).toMatchObject({
        affectedRows: 1,
        insertId: 1n,
      })
      expect(rows).toEqual([
        {
          id: 1,
          name: "Ada",
        },
      ])
    } finally {
      client.close()
    }
  })

  test("binds positional values and normalizes mutation facts", async () => {
    const rows = [{ id: 7 }] as unknown as Row[]
    const execute = vi.fn(async () =>
      result({
        rows,
        rowsAffected: 1,
        lastInsertRowid: 7n,
      }),
    )
    const client = { execute } as unknown as Client
    const adapter = libsqlAdapter(client, {
      encoder: { encode: (value) => String(value) },
    })

    await expect(adapter.execute(request("insert"))).resolves.toEqual({
      rows,
      affectedRows: 1,
      insertId: 7n,
    })
    expect(execute).toHaveBeenCalledWith({
      sql: "SELECT ?",
      args: ["42"],
    })
  })

  test("omits unspecified mutation facts from read results", async () => {
    const rows = [{ id: 7 }] as unknown as Row[]
    const client = {
      execute: vi.fn(async () =>
        result({
          rows,
          rowsAffected: 0,
        }),
      ),
    } as unknown as Client

    await expect(libsqlAdapter(client).execute(request("select"))).resolves.toEqual({
      rows,
    })
  })

  test("commits callback transactions with a scoped adapter", async () => {
    const transactionExecute = vi.fn(async () => result())
    const transaction = {
      execute: transactionExecute,
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      close: vi.fn(),
      closed: false,
    } as unknown as Transaction
    const begin = vi.fn(async () => transaction)
    const client = { transaction: begin } as unknown as Client
    const adapter = libsqlAdapter(client, { transactionMode: "read" })

    await expect(
      adapter.transaction(async (scoped) => {
        await scoped.execute(request("select"))
        return "committed"
      }),
    ).resolves.toBe("committed")

    expect(begin).toHaveBeenCalledWith("read")
    expect(transaction.commit).toHaveBeenCalledOnce()
    expect(transaction.rollback).not.toHaveBeenCalled()
    expect(transaction.close).toHaveBeenCalledOnce()
  })

  test("rolls back a failed callback and closes the transaction", async () => {
    const transaction = {
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async function (this: { closed: boolean }) {
        this.closed = true
      }),
      close: vi.fn(),
      closed: false,
    } as unknown as Transaction
    const client = {
      transaction: vi.fn(async () => transaction),
    } as unknown as Client
    const failure = new Error("callback failed")

    await expect(
      libsqlAdapter(client).transaction(async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    expect(transaction.rollback).toHaveBeenCalledOnce()
    expect(transaction.close).toHaveBeenCalledOnce()
  })

  test("does not start work for an already aborted request", async () => {
    const execute = vi.fn(async () => result())
    const client = { execute } as unknown as Client
    const controller = new AbortController()

    controller.abort(new Error("cancelled"))

    await expect(
      libsqlAdapter(client).execute(request("select", controller.signal)),
    ).rejects.toThrow("cancelled")
    expect(execute).not.toHaveBeenCalled()
  })

  test("decodes portable logical fields from normalized libSQL rows", async () => {
    const records = table("qubu_libsql_typed_records", {
      enabled: boolean(),
      day: date(),
      instant: timestamp(),
      metadata: json<{ kind: string }>(),
    })
    const client = {
      execute: vi.fn(async () =>
        result({
          rows: [
            {
              enabled: 1,
              day: "2026-10-22",
              instant: "2026-10-22 12:30:00",
              metadata: '{"kind":"created"}',
            },
          ] as unknown as Row[],
        }),
      ),
    } as unknown as Client

    await expect(
      executeRows(
        select(
          {
            enabled: records.enabled,
            day: records.day,
            instant: records.instant,
            metadata: records.metadata,
          },
          from(records),
        ),
        libsqlAdapter(client),
      ),
    ).resolves.toEqual([
      {
        enabled: true,
        day: new Date("2026-10-22T00:00:00.000Z"),
        instant: new Date("2026-10-22T12:30:00.000Z"),
        metadata: { kind: "created" },
      },
    ])
  })

  test("preserves a callback failure when libSQL rollback also fails", async () => {
    const primary = new Error("callback failed")
    const cleanup = new Error("rollback failed")
    const transaction = {
      rollback: vi.fn(async () => {
        throw cleanup
      }),
      close: vi.fn(),
      closed: false,
    } as unknown as Transaction
    const client = { transaction: async () => transaction } as unknown as Client

    const failure = await libsqlAdapter(client)
      .transaction(async () => {
        throw primary
      })
      .catch((error: unknown) => error)

    expect(transaction.close).toHaveBeenCalledOnce()
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([primary, cleanup])
    expect((failure as Error & { readonly cause?: unknown }).cause).toBe(primary)
  })

  test("preserves a callback failure when libSQL close also fails", async () => {
    const primary = new Error("callback failed")
    const cleanup = new Error("close failed")
    const transaction = {
      rollback: vi.fn(async () => undefined),
      close: vi.fn(() => {
        throw cleanup
      }),
      closed: false,
    } as unknown as Transaction
    const client = { transaction: async () => transaction } as unknown as Client

    const failure = await libsqlAdapter(client)
      .transaction(async () => {
        throw primary
      })
      .catch((error: unknown) => error)

    expect(transaction.rollback).toHaveBeenCalledOnce()
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([primary, cleanup])
    expect((failure as Error & { readonly cause?: unknown }).cause).toBe(primary)
  })
})
