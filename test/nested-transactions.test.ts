import type { DatabaseSync } from "node:sqlite"

import type { ClientBase } from "pg"
import { describe, expect, test } from "vitest"

import { mysql2Adapter } from "../adapters/mysql2/src/index.ts"
import { nodeSqliteAdapter } from "../adapters/node-sqlite/src/index.ts"
import { pgAdapter } from "../adapters/pg/src/index.ts"
import {
  qubu,
  select,
  integer,
  table,
  from,
  type HookOperation,
  type HookOutcome,
} from "../src/index.ts"

const users = table("users", { id: integer() })
const query = select({ id: users.id }, from(users))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return {
    promise,
    resolve,
  }
}

function fixture(kind: "pg" | "mysql2" | "node:sqlite") {
  const sql: string[] = []
  const failures = new Map<string, unknown[]>()
  let hold: Promise<void> | undefined

  function statement(text: string) {
    sql.push(text)
    const errors = failures.get(text)

    if (errors?.length) {
      throw errors.shift()
    }
  }

  async function asyncStatement(text: string) {
    statement(text)
    if (text.startsWith("SELECT") || text.startsWith("EXPLAIN")) {
      await hold
    }
  }

  const adapter =
    kind === "pg"
      ? pgAdapter({
          async query(text: string) {
            await asyncStatement(text)
            return {
              rows: [{ id: 1 }],
              rowCount: 1,
            }
          },
        } as unknown as ClientBase)
      : kind === "mysql2"
        ? mysql2Adapter({
            async execute({ sql }) {
              await asyncStatement(sql)
              return [[{ id: 1 }], []]
            },
            async beginTransaction() {
              statement("BEGIN")
            },
            async commit() {
              statement("COMMIT")
            },
            async rollback() {
              statement("ROLLBACK")
            },
          })
        : nodeSqliteAdapter(
            {
              isTransaction: true,
              exec: statement,
              prepare(text: string) {
                statement(text)
                return {
                  columns: () => [{ name: "id" }],
                  all: () => [{ id: 1 }],
                }
              },
            } as unknown as DatabaseSync,
            { transactionMode: "deferred" },
          )

  return {
    adapter,
    sql,
    failures,
    hold(promise: Promise<void>) {
      hold = promise
    },
  }
}

for (const kind of ["pg", "mysql2", "node:sqlite"] as const) {
  describe(kind, () => {
    test("nests savepoints, recovers a caught failure, and keeps hook ancestry", async () => {
      const f = fixture(kind)
      const operations: HookOperation[] = []
      const outcomes: HookOutcome[] = []
      const db = qubu(f.adapter, {
        hooks: {
          onOperationStart(operation) {
            operations.push(operation)
            return (outcome) => {
              outcomes.push(outcome)
            }
          },
        },
      })
      const error = new Error("inner")

      await db.transaction(async (outer) => {
        await expect(
          outer.transaction(async (inner) => {
            await inner.transaction(
              async (deepest) => {
                await deepest.explain(query)
              },
              { hookMetadata: { depth: 2 } },
            )
            throw error
          }),
        ).rejects.toBe(error)
        await outer.transaction(async (inner) => {
          await inner.execute(query)
        })
        await outer.execute(query)
      })
      expect(
        f.sql.filter((sql) => !sql.startsWith("SELECT") && !sql.startsWith("EXPLAIN")),
      ).toEqual([
        kind === "node:sqlite" ? "BEGIN DEFERRED" : "BEGIN",
        "SAVEPOINT qubu_sp_1",
        "SAVEPOINT qubu_sp_2",
        "RELEASE SAVEPOINT qubu_sp_2",
        "ROLLBACK TO SAVEPOINT qubu_sp_1",
        "RELEASE SAVEPOINT qubu_sp_1",
        "SAVEPOINT qubu_sp_3",
        "RELEASE SAVEPOINT qubu_sp_3",
        "COMMIT",
      ])
      expect(operations.map(({ kind, parentId }) => [kind, parentId])).toEqual([
        ["transaction", undefined],
        ["transaction", 1],
        ["transaction", 2],
        ["explain", 3],
        ["transaction", 1],
        ["execute", 5],
        ["execute", 1],
      ])
      expect(operations[2].metadata).toEqual({ depth: 2 })
      expect(outcomes.filter((outcome) => outcome.status === "error")).toHaveLength(1)
    })

    test("rolls back the outer transaction on an uncaught nested failure", async () => {
      const f = fixture(kind)
      const error = new Error("callback")

      await expect(
        qubu(f.adapter).transaction(async (outer) => {
          await outer.transaction(async () => {
            throw error
          })
        }),
      ).rejects.toBe(error)
      expect(f.sql.slice(-3)).toEqual([
        "ROLLBACK TO SAVEPOINT qubu_sp_1",
        "RELEASE SAVEPOINT qubu_sp_1",
        "ROLLBACK",
      ])
    })

    test("rejects finished scopes and operations outside the active child", async () => {
      const f = fixture(kind)
      const db = qubu(f.adapter)
      let retained!: Parameters<Parameters<typeof db.transaction>[0]>[0]

      await db.transaction(async (outer) => {
        retained = outer
        const gate = deferred()
        const child = outer.transaction(async (inner) => {
          await expect(outer.execute(query)).rejects.toThrow("active child")
          await expect(outer.explain(query)).rejects.toThrow("active child")
          await expect(db.execute(query)).rejects.toThrow("active transaction")
          await expect(db.transaction(async () => {})).rejects.toThrow("active transaction")
          await inner.execute(query)
          await gate.promise
        })

        await expect(outer.transaction(async () => {})).rejects.toThrow("active child")
        gate.resolve()
        await child
      })
      const count = f.sql.length

      await expect(retained.execute(query)).rejects.toThrow("finished")
      await expect(retained.explain(query)).rejects.toThrow("finished")
      await expect(retained.transaction(async () => {})).rejects.toThrow("finished")
      expect(f.sql).toHaveLength(count)
    })

    test("invalidates an inner client before the outer transaction finishes", async () => {
      const f = fixture(kind)

      await qubu(f.adapter).transaction(async (outer) => {
        let retained = outer

        await outer.transaction(async (inner) => {
          retained = inner
        })
        await expect(retained.execute(query)).rejects.toThrow("finished")
        await outer.execute(query)
      })
    })

    test("waits for an abandoned child before rolling back the outer scope", async () => {
      const f = fixture(kind)
      const gate = deferred()
      const entered = deferred()
      const transaction = qubu(f.adapter).transaction(async (outer) => {
        void outer.transaction(async (inner) => {
          entered.resolve()
          await gate.promise
          await inner.execute(query)
        })
      })

      await entered.promise
      expect(f.sql).not.toContain("ROLLBACK")
      expect(f.sql).not.toContain("COMMIT")
      gate.resolve()
      await expect(transaction).rejects.toThrow("pending operations or child scopes")
      expect(f.sql.slice(-2)).toEqual(["RELEASE SAVEPOINT qubu_sp_1", "ROLLBACK"])
    })

    for (const failedStatement of [
      "SAVEPOINT qubu_sp_1",
      "ROLLBACK TO SAVEPOINT qubu_sp_1",
      "RELEASE SAVEPOINT qubu_sp_1",
    ]) {
      test(`poisons the outer transaction after failed recovery at ${failedStatement}`, async () => {
        const f = fixture(kind)
        const primary = new Error("callback")
        const cleanup = new Error("savepoint")

        f.failures.set(failedStatement, [cleanup])
        let nestedError: unknown
        const transaction = qubu(f.adapter).transaction(async (outer) => {
          try {
            await outer.transaction(async () => {
              throw primary
            })
          } catch (error) {
            nestedError = error
          }

          await expect(outer.execute(query)).rejects.toThrow("unsafe")
        })
        const error = await transaction.catch((error) => error)

        expect(error).toBe(nestedError)
        if (failedStatement !== "SAVEPOINT qubu_sp_1") {
          expect(error.errors).toEqual([primary, cleanup])
        }

        expect(f.sql.at(-1)).toBe("ROLLBACK")
        expect(f.sql).not.toContain("COMMIT")
      })
    }

    test("recovers a failed savepoint release and preserves the original error", async () => {
      const f = fixture(kind)
      const failure = new Error("release")

      f.failures.set("RELEASE SAVEPOINT qubu_sp_1", [failure])
      await qubu(f.adapter).transaction(async (outer) => {
        await expect(outer.transaction(async () => 1)).rejects.toBe(failure)
        await outer.execute(query)
      })
      expect(f.sql).toContain("ROLLBACK TO SAVEPOINT qubu_sp_1")
      expect(f.sql.at(-1)).toBe("COMMIT")
    })

    test("preserves primary and outer rollback failures", async () => {
      const f = fixture(kind)
      const primary = new Error("callback")
      const cleanup = new Error("rollback")

      f.failures.set("ROLLBACK", [cleanup])
      await expect(
        qubu(f.adapter).transaction(async () => {
          throw primary
        }),
      ).rejects.toMatchObject({ errors: [primary, cleanup] })
    })

    test("rolls back an aborted nested callback without aborting recovery", async () => {
      const f = fixture(kind)
      const abort = new AbortController()
      const reason = new Error("cancelled")

      await qubu(f.adapter).transaction(async (outer) => {
        await expect(
          outer.transaction(
            async () => {
              abort.abort(reason)
            },
            { signal: abort.signal },
          ),
        ).rejects.toBe(reason)
        await outer.execute(query)
      })
      expect(f.sql).toContain("ROLLBACK TO SAVEPOINT qubu_sp_1")
      expect(f.sql.at(-1)).toBe("COMMIT")
    })
  })
}

for (const kind of ["pg", "mysql2"] as const) {
  test(`${kind} prevents savepoints crossing pending queries and drains abandoned queries`, async () => {
    const f = fixture(kind)
    const gate = deferred()
    const entered = deferred()

    f.hold(gate.promise)
    const transaction = qubu(f.adapter).transaction(async (outer) => {
      void outer.execute(query)
      await expect(outer.transaction(async () => {})).rejects.toThrow("pending operations")
      entered.resolve()
    })

    await entered.promise
    expect(f.sql).not.toContain("ROLLBACK")
    expect(f.sql.some((sql) => sql.startsWith("SAVEPOINT"))).toBe(false)
    gate.resolve()
    await expect(transaction).rejects.toThrow("pending operations")
    expect(f.sql.at(-1)).toBe("ROLLBACK")
  })
}

test("keeps mysql2 connection ownership until rollback finishes", async () => {
  const entered = deferred()
  const gate = deferred()
  const primary = new Error("callback")
  const db = qubu(
    mysql2Adapter({
      async execute() {
        return [[{ id: 1 }], []]
      },
      async beginTransaction() {},
      async commit() {},
      async rollback() {
        entered.resolve()
        await gate.promise
      },
    }),
  )
  const transaction = db.transaction(async () => {
    throw primary
  })

  await entered.promise
  await expect(db.execute(query)).rejects.toThrow("active transaction")
  await expect(db.transaction(async () => {})).rejects.toThrow("active transaction")
  gate.resolve()
  await expect(transaction).rejects.toBe(primary)
  await expect(db.rows(query)).resolves.toEqual([{ id: 1 }])
})
