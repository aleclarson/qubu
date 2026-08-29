import { expect, test } from "vitest"

import { postgresDialect } from "../src/dialects/postgres.ts"
import { standardDialect } from "../src/dialects/standard.ts"
import {
  eq,
  from,
  integer,
  qubu,
  select,
  table,
  where,
  type ExplainableQueryAdapter,
  type HookOperation,
  type HookOutcome,
  type QueryAdapter,
  type StreamingQueryAdapter,
  type TransactionOptions,
  type TransactionalQueryAdapter,
} from "../src/index.ts"

const users = table("users", { id: integer() })
const query = select({ id: users.id }, from(users), where(eq(users.id, 7)))

test("observes bound execution without exposing values or changing its result", async () => {
  const events: string[] = []
  const operations: HookOperation[] = []
  const outcomes: HookOutcome[] = []
  const metadata = {
    operation: "users.find",
    cached: false,
  }
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute() {
      events.push("adapter")
      return {
        rows: [{ id: 7 }],
        affectedRows: 2,
        insertId: "private-id",
      }
    },
  }
  const db = qubu(adapter, {
    hooks: {
      onOperationStart(operation) {
        events.push("start")
        operations.push(operation)
        return (outcome) => {
          events.push("end")
          outcomes.push(outcome)
        }
      },
    },
  })

  await expect(db.execute(query, { hookMetadata: metadata })).resolves.toEqual({
    rows: [{ id: 7 }],
    affectedRows: 2,
    insertId: "private-id",
  })

  expect(events).toEqual(["start", "adapter", "end"])
  expect(operations).toHaveLength(1)
  expect(operations[0]).toMatchObject({
    id: 1,
    kind: "execute",
    queryKind: "select",
    dialect: "standard-sql",
    parameterCount: 1,
    metadata,
  })
  expect(operations[0]).not.toHaveProperty("parameters")
  expect(Object.isFrozen(operations[0])).toBe(true)
  expect(Object.isFrozen(operations[0]?.metadata)).toBe(true)
  expect(outcomes[0]).toMatchObject({
    status: "success",
    rowCount: 1,
    affectedRows: 2,
    hasInsertId: true,
  })
  expect(outcomes[0]).not.toHaveProperty("rows")
  expect(outcomes[0]).not.toHaveProperty("insertId")
})

test("isolates start and completion hook failures from execution", async () => {
  const startFailure = new Error("start hook failed")
  const endFailure = new Error("end hook failed")
  const reported: unknown[] = []
  let calls = 0
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute() {
      calls += 1
      return { rows: [{ id: 7 }] }
    },
  }
  const startDb = qubu(adapter, {
    hooks: {
      onOperationStart() {
        throw startFailure
      },
      onHookError(error) {
        reported.push(error)
      },
    },
  })
  const endDb = qubu(adapter, {
    hooks: {
      onOperationStart() {
        return () => {
          throw endFailure
        }
      },
      onHookError(error) {
        reported.push(error)
      },
    },
  })

  await expect(startDb.rows(query)).resolves.toEqual([{ id: 7 }])
  await expect(endDb.rows(query)).resolves.toEqual([{ id: 7 }])

  expect(calls).toBe(2)
  expect(reported).toEqual([startFailure, endFailure])
})

test("reports the original adapter error", async () => {
  const failure = new Error("driver failed")
  let outcome: HookOutcome | undefined
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute() {
      throw failure
    },
  }
  const db = qubu(adapter, {
    hooks: {
      onOperationStart() {
        return (value) => {
          outcome = value
        }
      },
    },
  })

  await expect(db.execute(query)).rejects.toBe(failure)
  expect(outcome).toMatchObject({
    status: "error",
    error: failure,
  })
})

test("observes explain operations", async () => {
  const operations: HookOperation[] = []
  const outcomes: HookOutcome[] = []
  const adapter: ExplainableQueryAdapter = {
    dialect: postgresDialect(),
    async execute() {
      return { rows: [] }
    },
    async explain() {
      return { rows: [{ plan: "scan" }] }
    },
  }
  const db = qubu(adapter, {
    hooks: {
      onOperationStart(operation) {
        operations.push(operation)
        return (outcome) => outcomes.push(outcome)
      },
    },
  })

  await db.explain(query)

  expect(operations[0]).toMatchObject({
    kind: "explain",
    queryKind: "select",
  })
  expect(operations[0]?.kind === "explain" ? operations[0].sql : "").toMatch(/^EXPLAIN SELECT/u)
  expect(outcomes[0]).toMatchObject({
    status: "success",
    rowCount: 1,
  })
})

test("observes eager streams through completion and early consumer return", async () => {
  const events: string[] = []
  const outcomes: HookOutcome[] = []
  const adapter: StreamingQueryAdapter = {
    dialect: standardDialect(),
    async execute() {
      return { rows: [] }
    },
    stream() {
      events.push("adapter")
      return (async function* () {
        yield { id: 7 }
        yield { id: 8 }
      })()
    },
  }
  const db = qubu(adapter, {
    hooks: {
      onOperationStart(operation) {
        events.push(`start:${operation.kind}`)
        return (outcome) => outcomes.push(outcome)
      },
    },
  })

  const complete = db.stream(query)

  expect(events).toEqual(["start:stream", "adapter"])

  for await (const row of complete) {
    void row
  }

  const partial = db.stream(query)[Symbol.asyncIterator]()

  await partial.next()
  await partial.return?.()

  expect(outcomes).toMatchObject([
    {
      status: "success",
      rowCount: 2,
      streamEnd: "complete",
    },
    {
      status: "success",
      rowCount: 1,
      streamEnd: "consumer-return",
    },
  ])

  const abandoned = db.stream(query)

  expect(events.at(-2)).toBe("start:stream")
  expect(events.at(-1)).toBe("adapter")
  expect(outcomes).toHaveLength(2)
  void abandoned
})

test("reports stream iteration failures once", async () => {
  const failure = new Error("stream failed")
  const outcomes: HookOutcome[] = []
  const adapter: StreamingQueryAdapter = {
    dialect: standardDialect(),
    async execute() {
      return { rows: [] }
    },
    stream() {
      return (async function* () {
        yield { id: 7 }
        throw failure
      })()
    },
  }
  const db = qubu(adapter, {
    hooks: {
      onOperationStart() {
        return (outcome) => outcomes.push(outcome)
      },
    },
  })

  await expect(
    (async () => {
      for await (const row of db.stream(query)) {
        void row
      }
    })(),
  ).rejects.toBe(failure)
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0]).toMatchObject({
    status: "error",
    error: failure,
  })
})

test("parents transaction-scoped operations and keeps hook metadata from the adapter", async () => {
  const operations: HookOperation[] = []
  const outcomes: HookOutcome[] = []
  let receivedOptions: TransactionOptions | undefined
  const scoped: QueryAdapter = {
    dialect: standardDialect(),
    async execute() {
      return { rows: [{ id: 7 }] }
    },
  }
  const adapter: TransactionalQueryAdapter = {
    ...scoped,
    async transaction(callback, options) {
      receivedOptions = options
      return callback(scoped)
    },
  }
  const db = qubu(adapter, {
    hooks: {
      onOperationStart(operation) {
        operations.push(operation)
        return (outcome) => outcomes.push(outcome)
      },
    },
  })
  const signal = new AbortController().signal

  await db.transaction(
    async (transaction) => transaction.rows(query, { hookMetadata: { step: "read" } }),
    {
      signal,
      hookMetadata: { operation: "users.transaction" },
    },
  )

  expect(receivedOptions).toEqual({ signal })
  expect(operations).toMatchObject([
    {
      id: 1,
      kind: "transaction",
      metadata: { operation: "users.transaction" },
    },
    {
      id: 2,
      parentId: 1,
      kind: "execute",
      metadata: { step: "read" },
    },
  ])
  expect(outcomes).toMatchObject([
    {
      status: "success",
      rowCount: 1,
    },
    { status: "success" },
  ])
})
