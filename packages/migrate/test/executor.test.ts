import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { expect, test } from "vitest"

import {
  sealExecutableArtifact,
  type ProgramTransactionRequirement,
} from "../src/artifact/index.ts"
import { compileMigrationProgram } from "../src/artifact/sqlite.ts"
import {
  executeMigrations,
  MigrationExecutionError,
  reconcileAttempt,
} from "../src/executor/index.ts"
import { createMigrationPlan } from "../src/plan/index.ts"
import { DeterministicFakeMigrationAdapter, failAtBoundary } from "../src/testing/index.ts"

const dialect = { name: "sqlite", version: 1 } as const

function snapshot(withTable = false): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 2,
    dialect,
    namingPolicy: { name: "test", version: 1 },
    namespace: { kind: "sqlite-database", name: "main" },
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

async function artifact(transaction: ProgramTransactionRequirement = "required") {
  const before = snapshot()
  const plan = createMigrationPlan(diffSnapshots(before, snapshot(true)))
  if (!plan.ok) throw new Error("fixture plan failed")
  const compiled = compileMigrationProgram(plan.plan)
  if (!compiled.ok) throw new Error("fixture program failed")
  return sealExecutableArtifact({
    format: "qubu-executable-migration",
    version: 1,
    id: "create-accounts",
    sequence: 0,
    parentArtifactDigest: null,
    dialect,
    plan: plan.plan,
    renderer: { id: "qubu-sqlite", version: 1, dialect },
    program: {
      ...compiled.program,
      phases: compiled.program.phases.map((phase) => ({
        ...phase,
        transaction,
        postconditions: phase.postconditions.length
          ? phase.postconditions
          : [{ id: `post-${phase.id}`, type: "statement" as const, value: "SELECT 1" }],
      })),
    },
    beforeSnapshot: { value: before },
    afterSnapshot: { value: snapshot(true) },
    approvals: [],
    provenance: { source: "unit-test" },
  })
}

test("executes on one pinned session and becomes idempotent from the journal head", async () => {
  const migration = await artifact()
  const adapter = new DeterministicFakeMigrationAdapter({
    snapshotDigest: migration.beforeSnapshot.digest,
  })
  const options = { now: () => "2026-01-01T00:00:00.000Z", createAttemptId: () => "attempt-1" }
  const first = await executeMigrations({ repository: [migration], adapter, options })
  const second = await executeMigrations({
    repository: [migration],
    adapter,
    options: { ...options, createAttemptId: () => "unused" },
  })

  expect(first.applied).toMatchObject([{ artifactId: "create-accounts", atomicity: "atomic" }])
  expect(second).toMatchObject({ applied: [], head: migration.artifactDigest, idempotent: true })
  expect(await adapter.journal.listApplied()).toHaveLength(1)
  expect(adapter.events.filter((event) => event === "open-session")).toHaveLength(2)
  expect(adapter.events.at(-1)).toBe("close-session")
})

test("rolls back a required phase and releases locks and lease after an injected fault", async () => {
  const migration = await artifact()
  const adapter = new DeterministicFakeMigrationAdapter({
    snapshotDigest: migration.beforeSnapshot.digest,
  })
  await expect(
    executeMigrations({
      repository: [migration],
      adapter,
      options: {
        createAttemptId: () => "attempt-fault",
        onBoundary: failAtBoundary("checkpoint-statement"),
      },
    }),
  ).rejects.toBeInstanceOf(MigrationExecutionError)

  expect(adapter.executions).toEqual([])
  expect((await adapter.journal.listAttempts())[0]?.state).toBe("rolled_back")
  expect(adapter.events).toEqual(
    expect.arrayContaining([
      "rollback",
      "release-lock:exclusive",
      "release-lease",
      "close-session",
    ]),
  )
})

test("marks a checkpointed forbidden phase for recovery after a statement takes effect", async () => {
  const migration = await artifact("forbidden")
  const adapter = new DeterministicFakeMigrationAdapter({
    snapshotDigest: migration.beforeSnapshot.digest,
  })
  await expect(
    executeMigrations({
      repository: [migration],
      adapter,
      options: {
        createAttemptId: () => "attempt-forbidden",
        onBoundary: failAtBoundary("checkpoint-statement"),
      },
    }),
  ).rejects.toBeInstanceOf(MigrationExecutionError)

  expect(adapter.executions.length).toBeGreaterThan(0)
  expect((await adapter.journal.listAttempts())[0]?.state).toBe("recovery_required")
})

test("executes optional phases without a transaction when the adapter declines one", async () => {
  const migration = await artifact("optional")
  const adapter = new DeterministicFakeMigrationAdapter({
    snapshotDigest: migration.beforeSnapshot.digest,
    capabilities: { optionalTransactions: false },
  })
  const result = await executeMigrations({
    repository: [migration],
    adapter,
    options: { createAttemptId: () => "attempt-optional" },
  })
  expect(result.applied[0]?.atomicity).toBe("checkpointed")
  expect(adapter.events).not.toContain("begin")
  expect(adapter.executions.every((execution) => !execution.transaction)).toBe(true)
})

test("refuses required phases when transactional DDL is not proven", async () => {
  const migration = await artifact("required")
  const adapter = new DeterministicFakeMigrationAdapter({
    snapshotDigest: migration.beforeSnapshot.digest,
    capabilities: { transactionalDdl: false },
  })
  await expect(executeMigrations({ repository: [migration], adapter })).rejects.toMatchObject({
    code: "capability",
    retry: "safe",
  })
  expect(adapter.executions).toEqual([])
  expect(adapter.events.at(-1)).toBe("close-session")
})

test("serializes concurrent runners and lets the follower observe the new head", async () => {
  const migration = await artifact()
  const adapter = new DeterministicFakeMigrationAdapter({
    snapshotDigest: migration.beforeSnapshot.digest,
  })
  const [first, second] = await Promise.all([
    executeMigrations({
      repository: [migration],
      adapter,
      options: { createAttemptId: () => "attempt-a" },
    }),
    executeMigrations({
      repository: [migration],
      adapter,
      options: { createAttemptId: () => "attempt-b" },
    }),
  ])
  expect([first.idempotent, second.idempotent].sort()).toEqual([false, true])
  expect(await adapter.journal.listApplied()).toHaveLength(1)
})

test("keeps tagged parameters at the adapter binding boundary and redacts them from errors", async () => {
  const migration = await artifact()
  const secret = "never-print-this"
  const altered = await sealExecutableArtifact({
    ...migration,
    program: {
      ...migration.program,
      phases: migration.program.phases.map((phase) => ({
        ...phase,
        statements: phase.statements.map((statement) => ({
          ...statement,
          parameters: [{ type: "string" as const, value: secret }],
        })),
      })),
    },
  })
  const adapter = new DeterministicFakeMigrationAdapter({
    snapshotDigest: altered.beforeSnapshot.digest,
    classifyFailure: "uncertain",
  })
  const error = await executeMigrations({
    repository: [altered],
    adapter,
    options: {
      createAttemptId: () => "attempt-secret",
      onBoundary: failAtBoundary("checkpoint-statement"),
    },
  }).catch((value) => value)
  expect(String(error)).not.toContain(secret)
})

test("refuses tagged parameter types the adapter has not proven", async () => {
  const migration = await artifact()
  const {
    artifactDigest: _artifactDigest,
    planDigest: _planDigest,
    programDigest: _programDigest,
    canonicalization: _canonicalization,
    digestAlgorithm: _digestAlgorithm,
    ...unsealed
  } = migration
  const altered = await sealExecutableArtifact({
    ...unsealed,
    program: {
      ...migration.program,
      phases: migration.program.phases.map((phase) => ({
        ...phase,
        statements: phase.statements.map((statement) => ({
          ...statement,
          parameters: [{ type: "string" as const, value: "bound" }],
        })),
      })),
    },
  })
  const adapter = new DeterministicFakeMigrationAdapter({
    snapshotDigest: altered.beforeSnapshot.digest,
    capabilities: { parameters: ["null"] },
  })
  await expect(executeMigrations({ repository: [altered], adapter })).rejects.toMatchObject({
    code: "capability",
    retry: "safe",
  })
  expect(adapter.executions).toEqual([])
})

test("requires live proof before reconciling an abandoned attempt", async () => {
  const migration = await artifact("forbidden")
  const adapter = new DeterministicFakeMigrationAdapter({
    snapshotDigest: migration.beforeSnapshot.digest,
  })
  await executeMigrations({
    repository: [migration],
    adapter,
    options: {
      createAttemptId: () => "attempt-reconcile",
      onBoundary: failAtBoundary("checkpoint-statement"),
    },
  }).catch(() => undefined)

  await expect(
    reconcileAttempt({
      journal: adapter.journal,
      attemptId: "attempt-reconcile",
      outcome: "rolled_back",
      reason: "Operator inspected live schema",
      verify: async () => false,
    }),
  ).rejects.toMatchObject({ code: "recovery-required" })
  await reconcileAttempt({
    journal: adapter.journal,
    attemptId: "attempt-reconcile",
    outcome: "rolled_back",
    reason: "Operator inspected live schema",
    verify: async () => true,
  })
  expect((await adapter.journal.listAttempts())[0]?.state).toBe("rolled_back")
})

test.each([
  "verify-repository",
  "open-session",
  "acquire-lease",
  "read-metadata",
  "list-applied",
  "list-attempts",
  "read-snapshot",
  "create-attempt",
  "transition-running",
  "acquire-ddl-lock",
  "begin-transaction",
  "precondition",
  "checkpoint-phase-started",
  "execute-statement",
  "checkpoint-statement",
  "postcondition",
  "checkpoint-phase",
  "append-history",
  "head-cas",
  "transition-attempt",
  "commit-transaction",
  "release-ddl-lock",
  "release-lease",
  "close-session",
] as const)("cleans up after a fault at the %s await boundary", async (target) => {
  const migration = await artifact()
  const adapter = new DeterministicFakeMigrationAdapter({
    snapshotDigest: migration.beforeSnapshot.digest,
  })
  await expect(
    executeMigrations({
      repository: [migration],
      adapter,
      options: { createAttemptId: () => `attempt-${target}`, onBoundary: failAtBoundary(target) },
    }),
  ).rejects.toBeDefined()

  if (target !== "verify-repository" && target !== "open-session" && target !== "close-session") {
    expect(adapter.events).toContain("close-session")
  }
  if (!["verify-repository", "open-session", "acquire-lease", "release-lease"].includes(target)) {
    expect(adapter.events).toContain("release-lease")
  }
})

test("marks recovery required when rollback itself fails", async () => {
  const migration = await artifact()
  const adapter = new DeterministicFakeMigrationAdapter({
    snapshotDigest: migration.beforeSnapshot.digest,
  })
  const onBoundary = async (boundary: string) => {
    if (boundary === "checkpoint-statement" || boundary === "rollback-transaction")
      throw new Error(`Injected ${boundary} failure`)
  }
  await expect(
    executeMigrations({
      repository: [migration],
      adapter,
      options: { createAttemptId: () => "attempt-rollback", onBoundary },
    }),
  ).rejects.toMatchObject({ code: "uncertain-outcome" })
  expect((await adapter.journal.listAttempts())[0]?.state).toBe("recovery_required")
})
