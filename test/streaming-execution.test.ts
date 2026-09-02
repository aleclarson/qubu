import { expect, test } from "vitest"

import { postgresDialect } from "../src/dialects/postgres.ts"
import { standardDialect } from "../src/dialects/standard.ts"
import {
  boolean,
  booleanResultDecoder,
  eq,
  from,
  insertInto,
  integer,
  qubu,
  returning,
  select,
  stream,
  table,
  unionAll,
  values,
  where,
  type ExecutionRequest,
  type StreamableQuery,
  type StreamingQueryAdapter,
  type StreamingTransactionalQueryAdapter,
} from "../src/index.ts"

const users = table("users", { id: integer() })
const query = select({ id: users.id }, from(users), where(eq(users.id, 7)))

test("forwards the rendered stream request and signal to the adapter", async () => {
  let received: ExecutionRequest | undefined
  const adapter: StreamingQueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>() {
      return { rows: [] as readonly TRow[] }
    },
    stream<TRow extends object>(request: ExecutionRequest) {
      received = request
      return (async function* () {
        yield { id: 7 } as TRow
      })()
    },
  }
  const controller = new AbortController()

  const rows: { id: number }[] = []

  for await (const row of stream(query, adapter, {
    dialect: postgresDialect(),
    signal: controller.signal,
  })) {
    rows.push(row)
  }

  expect(received).toEqual({
    statement: {
      text: 'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = $1)',
      parameters: [7],
    },
    queryKind: "select",
    resultShape: { fields: [{ name: "id", sqlType: "integer" }] },
    signal: controller.signal,
  })
  expect(rows).toEqual([{ id: 7 }])
})

test("streams set operations and rejects mutations at runtime", async () => {
  const requests: ExecutionRequest[] = []
  const adapter: StreamingQueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>() {
      return { rows: [] as readonly TRow[] }
    },
    stream<TRow extends object>(request: ExecutionRequest) {
      requests.push(request)
      return (async function* () {
        yield { id: 7 } as TRow
      })()
    },
  }
  const setQuery = unionAll(query, select({ id: users.id }, from(users)))
  const setRows: { id: number }[] = []

  for await (const row of stream(adapter, setQuery)) {
    setRows.push(row)
  }

  const mutation = insertInto(users, values({ id: 8 }), returning({ id: users.id }))

  expect(() =>
    stream(mutation as unknown as StreamableQuery<{ id: number }>, adapter),
  ).toThrowError("Only SELECT and set-operation queries can be streamed; received insert")

  expect(setRows).toEqual([{ id: 7 }])
  expect(requests).toHaveLength(1)
  expect(requests[0]?.queryKind).toBe("set")
})

test("decodes streamed set-operation rows lazily", async () => {
  const flags = table("flags", { active: boolean() })
  const left = select({ enabled: flags.active }, from(flags))
  const query = unionAll(left, select({ enabled: flags.active }, from(flags)))
  const adapter: StreamingQueryAdapter = {
    dialect: standardDialect(),
    decoders: { boolean: booleanResultDecoder },
    async execute() {
      return { rows: [] }
    },
    stream() {
      return (async function* () {
        yield { enabled: 1 }
      })()
    },
  }

  const rows = []

  for await (const row of stream(query, adapter)) {
    rows.push(row)
  }

  expect(rows).toEqual([{ enabled: true }])
})

test("adds stream to a bound client with a streaming adapter", async () => {
  const adapter: StreamingQueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>() {
      return { rows: [] as readonly TRow[] }
    },
    stream<TRow extends object>() {
      return (async function* () {
        yield { id: 7 } as TRow
      })()
    },
  }
  const db = qubu(adapter)
  const rows: { id: number }[] = []

  for await (const row of db.stream(query)) {
    rows.push(row)
  }

  expect(db.adapter).toBe(adapter)
  expect(rows).toEqual([{ id: 7 }])
})

test("forwards abort signals for adapter-owned cancellation", () => {
  let received: ExecutionRequest | undefined
  let cancelled = false
  const adapter: StreamingQueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>() {
      return { rows: [] as readonly TRow[] }
    },
    stream<TRow extends object>(request: ExecutionRequest) {
      received = request
      request.signal?.addEventListener(
        "abort",
        () => {
          cancelled = true
        },
        { once: true },
      )
      return (async function* () {
        yield { id: 7 } as TRow
      })()
    },
  }
  const controller = new AbortController()

  stream(query, adapter, { signal: controller.signal })
  controller.abort()

  expect(received?.signal).toBe(controller.signal)
  expect(cancelled).toBe(true)
})

test("delegates iterator cleanup for completion, early close, and failure", async () => {
  const events: string[] = []
  const failure = new Error("row decoding failed")
  let mode: "complete" | "partial" | "failure" = "complete"
  const adapter: StreamingQueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>() {
      return { rows: [] as readonly TRow[] }
    },
    stream<TRow extends object>() {
      const currentMode = mode

      return (async function* () {
        try {
          yield { id: 7 } as TRow
          if (currentMode === "failure") {
            throw failure
          }

          yield { id: 8 } as TRow
        } finally {
          events.push(`close:${currentMode}`)
        }
      })()
    },
  }

  const completeRows: { id: number }[] = []

  for await (const row of stream(query, adapter)) {
    completeRows.push(row)
  }

  mode = "partial"
  const iterator = stream(query, adapter)[Symbol.asyncIterator]()

  await iterator.next()
  await iterator.return?.()

  mode = "failure"
  await expect(
    (async () => {
      for await (const row of stream(query, adapter)) {
        void row
      }
    })(),
  ).rejects.toBe(failure)

  expect(completeRows).toEqual([{ id: 7 }, { id: 8 }])
  expect(events).toEqual(["close:complete", "close:partial", "close:failure"])
})

test("closes a transaction stream before the adapter commits", async () => {
  const events: string[] = []
  let streamOpen = false
  const transactionAdapter: StreamingQueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>() {
      return { rows: [] as readonly TRow[] }
    },
    stream<TRow extends object>() {
      streamOpen = true
      return (async function* () {
        try {
          yield { id: 7 } as TRow
        } finally {
          streamOpen = false
          events.push("close")
        }
      })()
    },
  }
  const adapter: StreamingTransactionalQueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>() {
      return { rows: [] as readonly TRow[] }
    },
    stream: transactionAdapter.stream,
    async transaction<T>(callback: (adapter: StreamingQueryAdapter) => Promise<T>) {
      events.push("begin")
      const result = await callback(transactionAdapter)

      expect(streamOpen).toBe(false)
      events.push("commit")
      return result
    },
  }

  await qubu(adapter).transaction(async (transaction) => {
    const iterator = transaction.stream(query)[Symbol.asyncIterator]()

    await iterator.next()
    await iterator.return?.()
  })

  expect(events).toEqual(["begin", "close", "commit"])
})
