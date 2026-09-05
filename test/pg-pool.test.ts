import type { Pool } from "pg"
import { expect, test, vi } from "vitest"

import { pgAdapter } from "../adapters/pg/src/index.ts"
import type { ExecutionRequest, ExplainRequest } from "../src/index.ts"

const request: ExecutionRequest = {
  statement: {
    text: "SELECT $1",
    parameters: [42],
  },
  queryKind: "select",
  resultShape: { fields: [] },
}
const explainRequest = {
  ...request,
  statement: {
    ...request.statement,
    text: "EXPLAIN SELECT $1",
  },
} as ExplainRequest

function fixture() {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({
    rows: [{ value: 42 }],
    rowCount: 1,
  }))
  const release = vi.fn((_discard?: boolean) => {})
  const connection = {
    query,
    release,
  }
  const pool = {
    totalCount: 1,
    connect: vi.fn(async () => connection),
    query: vi.fn(async (_sql: string, _values?: unknown[]) => ({
      rows: [{ value: 7 }],
      rowCount: 1,
    })),
    end: vi.fn(),
  }

  return {
    connection,
    pool,
    adapter: pgAdapter(pool as unknown as Pool),
  }
}

test("routes pooled queries and EXPLAIN through the pool with parameter encoding", async () => {
  const { pool, connection } = fixture()
  const adapter = pgAdapter(pool as unknown as Pool, {
    encoder: { encode: (value) => String(value) },
  })

  await expect(adapter.execute(request)).resolves.toEqual({ rows: [{ value: 7 }] })
  await expect(adapter.explain(explainRequest)).resolves.toEqual({ rows: [{ value: 7 }] })
  expect(pool.query.mock.calls).toEqual([
    ["SELECT $1", ["42"]],
    ["EXPLAIN SELECT $1", ["42"]],
  ])
  expect(pool.connect).not.toHaveBeenCalled()
  expect(connection.release).not.toHaveBeenCalled()
  expect(pool.end).not.toHaveBeenCalled()
})

test("isolates concurrent pooled transactions and unrelated queries", async () => {
  const { pool, connection, adapter } = fixture()
  const second = fixture().connection

  pool.connect.mockResolvedValueOnce(connection).mockResolvedValueOnce(second)
  let unblock!: () => void
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve
  })
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const first = adapter.transaction(async (transaction) => {
    await transaction.execute(request)
    started()
    await blocked
    await transaction.explain(explainRequest)
    return "first"
  })

  await ready
  await adapter.execute(request)
  await expect(
    adapter.transaction(async (transaction) => {
      await transaction.execute(request)
      return "second"
    }),
  ).resolves.toBe("second")
  expect(connection.release).not.toHaveBeenCalled()
  expect(second.query.mock.calls.map((call) => call[0])).toEqual(["BEGIN", "SELECT $1", "COMMIT"])
  unblock()
  await expect(first).resolves.toBe("first")
  expect(connection.query.mock.calls.map((call) => call[0])).toEqual([
    "BEGIN",
    "SELECT $1",
    "EXPLAIN SELECT $1",
    "COMMIT",
  ])
  expect(pool.query).toHaveBeenCalledExactlyOnceWith("SELECT $1", [42])
  expect(connection.release).toHaveBeenCalledExactlyOnceWith(false)
  expect(second.release).toHaveBeenCalledExactlyOnceWith(false)
  expect(pool.end).not.toHaveBeenCalled()
})

test.each(["BEGIN", "callback", "COMMIT", "ROLLBACK"])(
  "releases pooled clients after %s failure",
  async (stage) => {
    const { adapter, connection } = fixture()
    const primary = new Error("primary failure")
    const cleanup = new Error("rollback failure")

    connection.query.mockImplementation(async (sql) => {
      if (sql === stage) {
        throw stage === "ROLLBACK" ? cleanup : primary
      }

      return {
        rows: [],
        rowCount: 0,
      }
    })
    const result = adapter.transaction(async () => {
      if (stage === "callback" || stage === "ROLLBACK") {
        throw primary
      }

      return 1
    })

    if (stage === "ROLLBACK") {
      await expect(result).rejects.toMatchObject({
        cause: primary,
        errors: [primary, cleanup],
      })
    } else {
      await expect(result).rejects.toBe(primary)
    }

    expect(connection.release).toHaveBeenCalledExactlyOnceWith(
      stage === "BEGIN" || stage === "ROLLBACK",
    )
    expect(connection.query.mock.calls.map((call) => call[0])).toEqual(
      stage === "BEGIN"
        ? ["BEGIN"]
        : stage === "COMMIT"
          ? ["BEGIN", "COMMIT", "ROLLBACK"]
          : ["BEGIN", "ROLLBACK"],
    )
  },
)

test("preserves transaction and release failures", async () => {
  const { adapter, connection } = fixture()
  const primary = new Error("callback failed")
  const cleanup = new Error("release failed")

  connection.release.mockImplementation(() => {
    throw cleanup
  })
  await expect(
    adapter.transaction(async () => {
      throw primary
    }),
  ).rejects.toMatchObject({
    cause: primary,
    errors: [primary, cleanup],
  })
  expect(connection.release).toHaveBeenCalledOnce()
})

test("propagates release failure after commit without attempting rollback", async () => {
  const { adapter, connection } = fixture()
  const cleanup = new Error("release failed")

  connection.release.mockImplementation(() => {
    throw cleanup
  })
  await expect(adapter.transaction(async () => 1)).rejects.toBe(cleanup)
  expect(connection.query.mock.calls.map((call) => call[0])).toEqual(["BEGIN", "COMMIT"])
})

test("propagates acquisition failure without starting a transaction", async () => {
  const { adapter, pool, connection } = fixture()
  const error = new Error("connect failed")

  pool.connect.mockRejectedValueOnce(error)
  await expect(adapter.transaction(async () => 1)).rejects.toBe(error)
  expect(connection.query).not.toHaveBeenCalled()
  expect(connection.release).not.toHaveBeenCalled()
})

test("checks abort before acquisition and releases if aborted during acquisition", async () => {
  const { adapter, pool, connection } = fixture()
  const controller = new AbortController()

  pool.connect.mockImplementationOnce(async () => {
    controller.abort()
    return connection
  })
  const callback = vi.fn(async () => 1)

  await expect(adapter.transaction(callback, { signal: controller.signal })).rejects.toThrow()
  expect(connection.release).toHaveBeenCalledExactlyOnceWith(false)
  expect(connection.query).not.toHaveBeenCalled()
  await expect(adapter.transaction(callback, { signal: controller.signal })).rejects.toThrow()
  expect(pool.connect).toHaveBeenCalledOnce()
  expect(callback).not.toHaveBeenCalled()
})

test("rolls back and releases when aborted during the callback", async () => {
  const { adapter, connection } = fixture()
  const controller = new AbortController()

  await expect(
    adapter.transaction(
      async () => {
        controller.abort()
      },
      { signal: controller.signal },
    ),
  ).rejects.toThrow()
  expect(connection.query.mock.calls.map((call) => call[0])).toEqual(["BEGIN", "ROLLBACK"])
  expect(connection.release).toHaveBeenCalledExactlyOnceWith(false)
})

test("leaves directly supplied client ownership with the application", async () => {
  const { connection } = fixture()
  const adapter = pgAdapter(connection as never)

  await adapter.transaction(async (transaction) => {
    await transaction.execute(request)
  })
  await expect(
    adapter.transaction(async () => {
      throw new Error("failed")
    }),
  ).rejects.toThrow("failed")
  expect(connection.release).not.toHaveBeenCalled()
})
