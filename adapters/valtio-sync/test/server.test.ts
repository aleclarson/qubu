import type { QubuTransaction, QubuTransactionalClient } from "qubu"
import type { CollectionServerHandlers } from "valtio-sync/server"
import { expect, test } from "vitest"

import { applyOpsWithQubu } from "../src/index.ts"

test("runs a mutation and its sync event in one Qubu transaction", async () => {
  const calls: string[] = []
  const tx = {} as QubuTransaction
  const db = {
    async transaction<T>(callback: (transaction: QubuTransaction) => Promise<T>) {
      calls.push("begin")
      const result = await callback(tx)

      calls.push("commit")
      return result
    },
  } as QubuTransactionalClient
  const readChanges = async () => ({
    changes: {
      upserted: [],
      deleted: [],
    },
  })

  const handlers = applyOpsWithQubu({
    db,
    authorize({ collection, op }) {
      calls.push(`authorize:${collection}:${op.id}`)
    },
    checkConflict(input) {
      expect(input.tx).toBe(tx)
      calls.push("conflict")
    },
    syncEvents: {
      write(input) {
        expect(input.tx).toBe(tx)
        calls.push(`event:${input.collection}:${input.recordId}:${input.op}`)
        return 42
      },
    },
    handlers: {
      todos: {
        readChanges,
        async create(input) {
          expect(input.tx).toBe(tx)
          calls.push("create")
          return {
            record: {
              id: input.op.id,
              title: input.record.title,
            },
          }
        },
      },
    },
  })

  const todoHandlers = handlers.todos as CollectionServerHandlers<undefined>

  expect(todoHandlers.readChanges).toBe(readChanges)
  const result = await todoHandlers.create?.({
    request: new Request("https://example.test/sync"),
    ctx: undefined,
    op: {
      mutationId: "mutation-1",
      collection: "todos",
      type: "create",
      id: "todo-1",
      value: {
        id: "todo-1",
        title: "Draft",
      },
      touched: ["title"],
    },
    record: {
      id: "todo-1",
      title: "Draft",
    },
  })

  expect(result).toEqual({
    record: {
      id: "todo-1",
      title: "Draft",
    },
    serverVersion: 42,
  })
  expect(calls).toEqual([
    "begin",
    "authorize:todos:todo-1",
    "conflict",
    "create",
    "event:todos:todo-1:create",
    "commit",
  ])
})

test("preserves a handler-owned server version while still writing an event", async () => {
  let eventWrites = 0
  const tx = {} as QubuTransaction
  const db = {
    transaction: <T>(callback: (transaction: QubuTransaction) => Promise<T>) => callback(tx),
  } as QubuTransactionalClient
  const handlers = applyOpsWithQubu({
    db,
    syncEvents: {
      write() {
        eventWrites += 1
        return 42
      },
    },
    handlers: {
      todos: {
        update: () => ({ serverVersion: 9 }),
      },
    },
  })

  const todoHandlers = handlers.todos as CollectionServerHandlers<undefined>
  const result = await todoHandlers.update?.({
    request: new Request("https://example.test/sync"),
    ctx: undefined,
    op: {
      mutationId: "mutation-2",
      collection: "todos",
      type: "update",
      id: "todo-1",
      patch: { title: "Done" },
      touched: ["title"],
      baseServerVersion: 8,
    },
    patch: { title: "Done" },
  })

  expect(result).toEqual({ serverVersion: 9 })
  expect(eventWrites).toBe(1)
})

test("does not write a sync event when a mutation fails", async () => {
  let eventWrites = 0
  const tx = {} as QubuTransaction
  const db = {
    transaction: <T>(callback: (transaction: QubuTransaction) => Promise<T>) => callback(tx),
  } as QubuTransactionalClient
  const handlers = applyOpsWithQubu({
    db,
    syncEvents: {
      write() {
        eventWrites += 1
        return 1
      },
    },
    handlers: {
      todos: {
        delete() {
          throw new Error("delete failed")
        },
      },
    },
  })

  await expect(
    (handlers.todos as CollectionServerHandlers<undefined>).delete?.({
      request: new Request("https://example.test/sync"),
      ctx: undefined,
      op: {
        mutationId: "mutation-3",
        collection: "todos",
        type: "delete",
        id: "todo-1",
        baseServerVersion: 9,
      },
    }),
  ).rejects.toThrow("delete failed")
  expect(eventWrites).toBe(0)
})
