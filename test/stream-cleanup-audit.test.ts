import { expect, test } from "vitest"

import { sqliteDialect } from "../src/dialects/sqlite.ts"
import { qubu, select, value, type StreamingQueryAdapter } from "../src/index.ts"

test.each([false, true])(
  "closes adapter resources and observations when returning a stream (read first: %s)",
  async (readFirst) => {
    let openResources = 0
    let openObservations = 0
    let reads = 0
    const adapter: StreamingQueryAdapter = {
      dialect: sqliteDialect(),
      async execute() {
        return { rows: [] }
      },
      stream() {
        openResources++
        let closed = false

        const iterator: AsyncIterableIterator<Readonly<Record<string, unknown>>> = {
          [Symbol.asyncIterator]() {
            return this
          },
          async next() {
            reads++
            return {
              done: false as const,
              value: { id: 1 },
            }
          },
          async return() {
            if (!closed) {
              closed = true
              openResources--
            }

            return {
              done: true as const,
              value: undefined,
            }
          },
        }

        return iterator
      },
    }
    const db = qubu(adapter, {
      hooks: {
        onOperationStart() {
          openObservations++
          return () => {
            openObservations--
          }
        },
      },
    })
    const iterator = db.stream(select({ id: value(1) }))[Symbol.asyncIterator]()

    if (readFirst) {
      await iterator.next()
    }

    await iterator.return?.()

    expect({
      openResources,
      openObservations,
      reads,
    }).toEqual({
      openResources: 0,
      openObservations: 0,
      reads: readFirst ? 1 : 0,
    })
  },
)
