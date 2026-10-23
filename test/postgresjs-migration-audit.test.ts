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
