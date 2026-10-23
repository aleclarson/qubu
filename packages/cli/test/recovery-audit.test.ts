import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sealExecutableArtifact } from "@qubu/migrate/artifact"
import { compileMigrationProgram } from "@qubu/migrate/artifact/sqlite"
import type { MigrationAdapter } from "@qubu/migrate/executor"
import { createMigrationPlan } from "@qubu/migrate/plan"
import { DeterministicFakeMigrationAdapter, fakeDigest } from "@qubu/migrate/testing"
import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { afterEach, expect, test } from "vitest"

import { cliExitCodes, runCli } from "../src/cli.ts"
import type { QubuCliConfig } from "../src/config.ts"
import { FileArtifactRepository } from "../src/repository.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

test("closes the reconciliation session when releasing its lease fails", async () => {
  const fake = new DeterministicFakeMigrationAdapter({ snapshotDigest: fakeDigest("a") })

  await fake.journal.createAttempt({
    id: "interrupted",
    artifactId: "create-accounts",
    artifactDigest: fakeDigest("b"),
    expectedHead: null,
    state: "started",
    startedAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
  })
  await fake.journal.transitionAttempt("interrupted", "recovery_required")

  const releaseFailure = new Error("Lease release failed")
  const adapter: MigrationAdapter = {
    async openMigrationSession(signal) {
      const session = await fake.openMigrationSession(signal)

      return {
        ...session,
        async releaseLease() {
          await session.releaseLease()
          throw releaseFailure
        },
      }
    },
  }
  const errors: string[] = []
  const exit = await runCli(
    [
      "migrate",
      "reconcile",
      "interrupted",
      "--outcome",
      "rolled_back",
      "--reason",
      "Verified the complete pre-state",
      "--format",
      "json",
    ],
    {
      cwd: await temporaryDirectory(),
      loadConfig: async (): Promise<QubuCliConfig> => ({
        artifacts: "migrations",
        snapshot: snapshot(),
        adapter: () => adapter,
        verifyReconciliation: async () => true,
      }),
      stderr: (text) => errors.push(text),
    },
  )

  expect(exit).toBe(cliExitCodes.adapter)
  expect((await fake.journal.listAttempts())[0]?.state).toBe("rolled_back")
  expect(fake.events).toContain("close-session")
})

test("reports the recovery exit code when a commit outcome is uncertain", async () => {
  const cwd = await temporaryDirectory()
  const repository = new FileArtifactRepository("migrations", cwd)
  const migration = await artifact()

  await repository.write(migration)

  const commitFailure = new Error("Commit acknowledgement lost")
  const fake = new DeterministicFakeMigrationAdapter({
    snapshotDigest: migration.beforeSnapshot.digest,
    classifyFailure: "uncertain",
  })
  const adapter: MigrationAdapter = {
    async openMigrationSession(signal) {
      const session = await fake.openMigrationSession(signal)

      return {
        ...session,
        async commitTransaction() {
          throw commitFailure
        },
      }
    },
  }
  const errors: string[] = []
  const exit = await runCli(["migrate", "apply", "--format", "json", "--non-interactive"], {
    cwd,
    loadConfig: async (): Promise<QubuCliConfig> => ({
      artifacts: "migrations",
      adapter: () => adapter,
    }),
    stderr: (text) => errors.push(text),
  })

  // An uncertain commit leaves a recovery_required attempt that must be reconciled;
  // the same journal state exits as "recovery" through `migrate status`.
  expect(exit).toBe(cliExitCodes.recovery)
  expect((await fake.journal.listAttempts())[0]?.state).toBe("recovery_required")
})

test("reports the recovery exit code when a dry run is blocked by an interrupted attempt", async () => {
  const fake = new DeterministicFakeMigrationAdapter({ snapshotDigest: fakeDigest("a") })

  await fake.journal.createAttempt({
    id: "interrupted",
    artifactId: "create-accounts",
    artifactDigest: fakeDigest("b"),
    expectedHead: null,
    state: "started",
    startedAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
  })
  await fake.journal.transitionAttempt("interrupted", "recovery_required")

  const errors: string[] = []
  const exit = await runCli(
    ["migrate", "apply", "--dry-run", "--format", "json", "--non-interactive"],
    {
      cwd: await temporaryDirectory(),
      loadConfig: async (): Promise<QubuCliConfig> => ({
        artifacts: "migrations",
        adapter: () => fake,
      }),
      stderr: (text) => errors.push(text),
    },
  )

  // `migrate status` exits as "recovery" for the identical journal state.
  expect(exit).toBe(cliExitCodes.recovery)
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "qubu-cli-audit-"))

  temporaryDirectories.push(path)
  return path
}

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

async function artifact() {
  const before = snapshot()
  const plan = createMigrationPlan(diffSnapshots(before, snapshot(true)))

  if (!plan.ok) {
    throw new Error("fixture plan failed")
  }
  const compiled = compileMigrationProgram(plan.plan)

  if (!compiled.ok) {
    throw new Error("fixture program failed")
  }
  return sealExecutableArtifact({
    format: "qubu-executable-migration",
    version: 1,
    id: "create-accounts",
    sequence: 0,
    parentArtifactDigest: null,
    dialect: {
      name: "sqlite",
      version: 1,
    },
    plan: plan.plan,
    renderer: {
      id: "qubu-sqlite",
      version: 1,
      dialect: {
        name: "sqlite",
        version: 1,
      },
    },
    program: {
      ...compiled.program,
      phases: compiled.program.phases.map((phase) => ({
        ...phase,
        transaction: "required" as const,
      })),
    },
    beforeSnapshot: { value: before },
    afterSnapshot: { value: snapshot(true) },
    approvals: [],
    provenance: { source: "unit-test" },
  })
}
