import type { SchemaSnapshot } from "qubu/snapshot"
import { expect, test, vi } from "vitest"

import {
  captureBaseline,
  createBaseline,
  fromMigrationAdapter,
  type BaselineAdapter,
  type BaselineConfirmation,
} from "../src/baseline/index.ts"
import { DeterministicFakeMigrationAdapter } from "../src/testing/index.ts"

function snapshot(withTable = false): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect: {
      name: "sqlite",
      version: 1,
    },
    namingPolicy: {
      name: "test",
      version: 1,
    },
    namespace: {
      kind: "sqlite-database",
      name: "main",
    },
    capabilities: {
      generatedColumns: true,
      identityMetadata: true,
      checkConstraints: true,
      checkConstraintEnforcement: "enforced",
      expressionDecompilation: true,
      indexExpressions: true,
      indexPredicates: true,
      indexIncludedColumns: true,
      namespaces: true,
      visibility: "complete",
    },
    tables: withTable
      ? [
          {
            kind: "table",
            id: "accounts",
            physicalName: "accounts",
            columns: [],
            constraints: [],
            indexes: [],
          },
        ]
      : [],
    views: [],
    sequences: [],
    enums: [],
    domains: [],
    collations: [],
    triggers: [],
    routines: [],
    partitions: [],
    policies: [],
    extensions: [],
    deferredObjects: [],
    opaqueObjects: [],
    comments: [],
    ownership: [],
  }
}

const confirmation: BaselineConfirmation = {
  databaseTargetVerified: true,
  snapshotSourceVerified: true,
  zeroManagedDriftVerified: true,
  backupRestoreReady: true,
  otherMigratorsStopped: true,
  incompatibleApplicationPrevented: true,
  legacyHistoryCutoverAccepted: true,
}

test("preserves inspection failures while closing an adoption-only session", async () => {
  const failure = new Error("inspection failed")
  const close = vi.fn(async () => {
    throw new Error("cleanup failed")
  })
  const adapter: BaselineAdapter = {
    async openBaselineSession() {
      return {
        dialect: "sqlite",
        async readSnapshot() {
          throw failure
        },
        async assertEmptyHistory() {},
        async recordBaseline() {},
        close,
      }
    },
  }

  await expect(
    captureBaseline({
      adapter,
      scope: snapshot(),
    }),
  ).rejects.toBe(failure)
  expect(close).toHaveBeenCalledOnce()
})

test("closes the migration session even when releasing the adoption lease fails", async () => {
  const fake = new DeterministicFakeMigrationAdapter({ snapshotDigest: `sha256:${"0".repeat(64)}` })
  const adapter = fromMigrationAdapter({
    async openMigrationSession() {
      const session = await fake.openMigrationSession()

      return {
        ...session,
        async readSnapshot() {
          return {
            snapshot: snapshot(),
            unmanagedObjects: [],
          }
        },
        async releaseLease() {
          await session.releaseLease()
          throw new Error("release failed")
        },
      }
    },
  })

  await expect(
    captureBaseline({
      adapter,
      scope: snapshot(),
    }),
  ).rejects.toThrow("release failed")
  expect(fake.events.filter((event) => event === "close-session")).toHaveLength(1)
})

test("reports a lost baseline commit response as uncertain even when rollback succeeds", async () => {
  const fake = new DeterministicFakeMigrationAdapter({
    snapshotDigest: `sha256:${"0".repeat(64)}`,
    classifyFailure: "uncertain",
  })
  const scope = snapshot()
  const adapter = fromMigrationAdapter({
    async openMigrationSession() {
      const session = await fake.openMigrationSession()

      return {
        ...session,
        async readSnapshot() {
          return {
            snapshot: scope,
            unmanagedObjects: [],
          }
        },
        async commitTransaction() {
          await session.commitTransaction()
          throw new Error("commit response lost")
        },
      }
    },
  })

  await expect(
    createBaseline({
      adapter,
      scope,
      candidate: scope,
      repository: [],
      id: "initial",
      provenance: { source: "test" },
      confirmation,
    }),
  ).rejects.toMatchObject({ code: "uncertain-outcome" })
  expect(await fake.journal.listApplied()).toHaveLength(1)
  expect((await fake.journal.listAttempts())[0]?.state).not.toBe("rolled_back")
  expect(fake.events).toContain("close-session")
})
