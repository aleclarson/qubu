import type { ReservedSql, Sql } from "postgres"
import { expect, test, vi } from "vitest"

import { migrationAdapter } from "../adapters/postgresjs/src/migration.ts"
import { fakeDigest } from "../packages/migrate/src/testing/index.ts"

function fixture() {
  const connections = [0, 1].map(() => ({
    unsafe: vi.fn(async () => Object.assign([], { count: 0 })),
    release: vi.fn(),
  }))
  const reserve = vi
    .fn()
    .mockResolvedValueOnce(connections[0])
    .mockResolvedValueOnce(connections[1])
  const readSnapshot = vi.fn(async (connection: ReservedSql) =>
    fakeDigest(connection === (connections[0] as unknown) ? "a" : "b"),
  )
  const adapter = migrationAdapter({ reserve } as unknown as Sql, { readSnapshot })

  return {
    adapter,
    connections,
    readSnapshot,
  }
}

test("reads each overlapping postgres.js migration snapshot on its own reserved connection", async () => {
  const { adapter, connections, readSnapshot } = fixture()
  const first = await adapter.openMigrationSession()
  const second = await adapter.openMigrationSession()

  try {
    expect.soft(await first.currentSnapshotDigest()).toBe(fakeDigest("a"))
    expect(await second.currentSnapshotDigest()).toBe(fakeDigest("b"))
    expect(readSnapshot.mock.calls.map(([connection]) => connection)).toEqual(connections)
  } finally {
    await second.close()
    await first.close()
  }

  for (const connection of connections) {
    expect(connection.release).toHaveBeenCalledOnce()
  }
})

test("keeps an older postgres.js migration session usable after a newer session closes", async () => {
  const { adapter, connections } = fixture()
  const first = await adapter.openMigrationSession()
  const second = await adapter.openMigrationSession()

  try {
    await second.close()
    expect(connections[1]!.release).toHaveBeenCalledOnce()
    expect(connections[0]!.release).not.toHaveBeenCalled()
    await expect(first.currentSnapshotDigest()).resolves.toBe(fakeDigest("a"))
  } finally {
    await second.close()
    await first.close()
  }
})

test("reads and releases sequential postgres.js migration sessions independently", async () => {
  const { adapter, connections } = fixture()

  for (const expected of ["a", "b"]) {
    const session = await adapter.openMigrationSession()

    try {
      expect(await session.currentSnapshotDigest()).toBe(fakeDigest(expected))
    } finally {
      await session.close()
    }
  }

  for (const connection of connections) {
    expect(connection.release).toHaveBeenCalledOnce()
  }
})

test.each([false, true])(
  "preserves migration initialization failure when postgres.js release also fails: %s",
  async (releaseFails) => {
    const { adapter, connections } = fixture()
    const primary = new Error("journal initialization failed")
    const cleanup = new Error("reserved connection release failed")

    connections[0]!.unsafe.mockRejectedValueOnce(primary)
    if (releaseFails) {
      connections[0]!.release.mockImplementationOnce(() => {
        throw cleanup
      })
    }

    const opening = adapter.openMigrationSession()

    if (releaseFails) {
      await expect(opening).rejects.toMatchObject({
        cause: primary,
        errors: [primary, cleanup],
      })
    } else {
      await expect(opening).rejects.toBe(primary)
    }

    expect(connections[0]!.release).toHaveBeenCalledOnce()
    expect(connections[0]!.unsafe).toHaveBeenCalledOnce()
  },
)

test("releases a postgres.js reservation cancelled before migration initialization", async () => {
  const controller = new AbortController()
  const reason = new Error("cancelled while reserving a connection")
  const connection = {
    unsafe: vi.fn(async () => Object.assign([], { count: 0 })),
    release: vi.fn(),
  }
  const reserve = vi.fn(async () => {
    controller.abort(reason)
    return connection
  })
  const adapter = migrationAdapter({ reserve } as unknown as Sql, {
    readSnapshot: async () => fakeDigest("a"),
  })
  const outcome = await adapter.openMigrationSession(controller.signal).then(
    (session) => ({ session }),
    (error: unknown) => ({ error }),
  )

  try {
    expect.soft(outcome).toEqual({ error: reason })
    expect.soft(connection.unsafe).not.toHaveBeenCalled()
    expect(connection.release).toHaveBeenCalledOnce()
  } finally {
    if ("session" in outcome) {
      await outcome.session.close()
    }
  }
})
