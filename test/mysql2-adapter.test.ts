import { describe, expect, test, vi } from "vitest"

import { mysql2Adapter, type Mysql2Connection } from "../adapters/mysql2/src/index.ts"
import type { ExecutionRequest } from "../src/execution.ts"
import { boolean, executeRows, from, integer, select, table } from "../src/index.ts"

type DriverResult = [unknown, readonly unknown[]]

function request(
  queryKind: ExecutionRequest["queryKind"],
  parameters: readonly unknown[] = [],
  resultShape: ExecutionRequest["resultShape"] = { fields: [] },
  signal?: AbortSignal,
): ExecutionRequest {
  return {
    statement: {
      text: "SELECT ?",
      parameters,
    },
    queryKind,
    resultShape,
    ...(signal === undefined ? {} : { signal }),
  }
}

function connectionFor(result: unknown) {
  const execute = vi.fn(async (_options: unknown) => [result, []] as DriverResult)
  const connection = {
    execute,
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
  }

  return {
    adapter: mysql2Adapter(connection as unknown as Mysql2Connection),
    connection,
  }
}

describe("mysql2 adapter", () => {
  test("decodes booleans and preserves numeric result fields", async () => {
    const flags = table("flags", {
      active: boolean(),
      attempts: integer(),
    })
    const query = select(
      {
        enabled: flags.active,
        attempts: flags.attempts,
      },
      from(flags),
    )
    const execute = vi.fn(
      async (_options: unknown) =>
        [
          [
            {
              enabled: 1,
              attempts: 1,
            },
          ],
          [],
        ] as DriverResult,
    )
    const adapter = mysql2Adapter({ execute } as unknown as Mysql2Connection)

    await expect(executeRows(query, adapter)).resolves.toEqual([
      {
        enabled: true,
        attempts: 1,
      },
    ])
    expect(execute).toHaveBeenCalledWith({
      sql: "SELECT `flags`.`active` AS `enabled`, `flags`.`attempts` AS `attempts` FROM `flags`",
      values: [],
      rowsAsArray: false,
      nestTables: false,
    })
  })

  test("rejects array and nested row shapes", async () => {
    const users = table("users", { id: integer() })
    const query = select({ id: users.id }, from(users))
    const cases: readonly [unknown, string][] = [
      [[[1]], "invalid row at index 0"],
      [[{ users: { id: 1 } }], 'missing result field "id"'],
    ]

    for (const [result, message] of cases) {
      const { adapter } = connectionFor(result)

      await expect(executeRows(query, adapter)).rejects.toThrow(message)
    }
  })

  test("rejects multiple result headers", async () => {
    const { adapter } = connectionFor([{ affectedRows: 1 }, { affectedRows: 2 }])

    await expect(adapter.execute(request("update"))).rejects.toThrow("multiple result headers")
  })

  test("binds undefined as SQL NULL without changing parameter positions", async () => {
    const { adapter, connection } = connectionFor({
      affectedRows: 0,
      changedRows: 0,
      insertId: 0,
    })

    await adapter.execute(request("update", [undefined, null, 7]))

    expect(connection.execute).toHaveBeenCalledWith({
      sql: "SELECT ?",
      values: [null, null, 7],
      rowsAsArray: false,
      nestTables: false,
    })
  })

  test("commits successful callback transactions with a scoped adapter", async () => {
    const events: string[] = []
    const connection = {
      execute: vi.fn(async () => [[], []] as DriverResult),
      beginTransaction: vi.fn(async () => {
        events.push("begin")
      }),
      commit: vi.fn(async () => {
        events.push("commit")
      }),
      rollback: vi.fn(async () => {
        events.push("rollback")
      }),
    }
    const adapter = mysql2Adapter(connection as unknown as Mysql2Connection)

    await expect(
      adapter.transaction(async (scoped) => {
        events.push("callback")
        expect(scoped.decoders).toBe(adapter.decoders)
        await scoped.execute(request("select"))
        return "committed"
      }),
    ).resolves.toBe("committed")
    expect(events).toEqual(["begin", "callback", "commit"])
  })

  test("preserves callback and commit failures through rollback", async () => {
    const callbackFailure = new Error("callback failed")
    const callbackConnection = connectionFor({ affectedRows: 0 }).connection
    const callbackAdapter = mysql2Adapter({
      ...callbackConnection,
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
    } as unknown as Mysql2Connection)

    await expect(
      callbackAdapter.transaction(async () => {
        throw callbackFailure
      }),
    ).rejects.toBe(callbackFailure)

    const commitFailure = new Error("commit failed")
    const rollback = vi.fn(async () => undefined)
    const commitAdapter = mysql2Adapter({
      execute: vi.fn(async () => [{ affectedRows: 0 }, []] as DriverResult),
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => {
        throw commitFailure
      }),
      rollback,
    } as unknown as Mysql2Connection)

    await expect(commitAdapter.transaction(async () => "committed")).rejects.toBe(commitFailure)
    expect(rollback).toHaveBeenCalledOnce()
  })

  test("retains rollback failures with the primary transaction error", async () => {
    const primary = new Error("callback failed")
    const rollbackFailure = new Error("rollback failed")
    const adapter = mysql2Adapter({
      execute: vi.fn(async () => [{ affectedRows: 0 }, []] as DriverResult),
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => {
        throw rollbackFailure
      }),
    } as unknown as Mysql2Connection)

    const thrown = await adapter
      .transaction(async () => {
        throw primary
      })
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(AggregateError)
    if (!(thrown instanceof AggregateError)) {
      throw thrown
    }

    expect(thrown.errors).toEqual([primary, rollbackFailure])
    expect(thrown.cause).toBe(primary)
  })

  test("rejects a transaction aborted during begin before invoking its callback", async () => {
    const controller = new AbortController()
    const reason = new Error("cancelled")
    const callback = vi.fn(async () => "unexpected")
    const rollback = vi.fn(async () => undefined)
    const adapter = mysql2Adapter({
      execute: vi.fn(async () => [[], []] as DriverResult),
      beginTransaction: vi.fn(async () => {
        controller.abort(reason)
      }),
      commit: vi.fn(async () => undefined),
      rollback,
    } as unknown as Mysql2Connection)

    await expect(adapter.transaction(callback, { signal: controller.signal })).rejects.toBe(reason)
    expect(callback).not.toHaveBeenCalled()
    expect(rollback).toHaveBeenCalledOnce()
  })

  test("does not start an already-aborted execution", async () => {
    const controller = new AbortController()
    const reason = new Error("cancelled before execution")
    const execute = vi.fn(async () => [[], []] as DriverResult)
    const adapter = mysql2Adapter({ execute } as unknown as Mysql2Connection)

    controller.abort(reason)

    await expect(
      adapter.execute(request("select", [], { fields: [] }, controller.signal)),
    ).rejects.toBe(reason)
    expect(execute).not.toHaveBeenCalled()
  })

  test("does not roll back after a commit that completes before cancellation", async () => {
    const controller = new AbortController()
    const reason = new Error("cancelled after commit")
    const rollback = vi.fn(async () => undefined)
    const adapter = mysql2Adapter({
      execute: vi.fn(async () => [[], []] as DriverResult),
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => {
        controller.abort(reason)
      }),
      rollback,
    } as unknown as Mysql2Connection)

    await expect(
      adapter.transaction(async () => "committed", { signal: controller.signal }),
    ).rejects.toBe(reason)
    expect(rollback).not.toHaveBeenCalled()
  })

  test("observes cancellation after an in-flight execution returns", async () => {
    const controller = new AbortController()
    const reason = new Error("cancelled")
    let resolveExecution!: (result: DriverResult) => void
    const execute = vi.fn(
      (_options: unknown) =>
        new Promise<DriverResult>((resolve) => {
          resolveExecution = resolve
        }),
    )
    const adapter = mysql2Adapter({ execute } as unknown as Mysql2Connection)
    const pending = adapter.execute(request("select", [], { fields: [] }, controller.signal))

    controller.abort(reason)
    resolveExecution([[{ id: 1 }], []])

    await expect(pending).rejects.toBe(reason)
  })

  test("returns explain rows and rejects non-row explain results", async () => {
    const { adapter } = connectionFor([{ plan: "Index Scan" }])

    await expect(adapter.explain(request("select"))).resolves.toEqual({
      rows: [{ plan: "Index Scan" }],
    })

    const malformed = connectionFor({ affectedRows: 1 }).adapter

    await expect(malformed.explain(request("select"))).rejects.toThrow(
      "EXPLAIN returned a non-row result",
    )
  })
})
