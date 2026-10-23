import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { expect, test } from "vitest"

import {
  sealExecutableArtifact,
  type ProgramTransactionRequirement,
} from "../src/artifact/index.ts"
import { compileMigrationProgram } from "../src/artifact/sqlite.ts"
import { executeMigrations } from "../src/executor/index.ts"
import { createMigrationPlan } from "../src/plan/index.ts"
import { DeterministicFakeMigrationAdapter } from "../src/testing/index.ts"

const dialect = {
  name: "sqlite",
  version: 1,
} as const

function snapshot(withTable = false): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect,
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

async function artifact(transaction: ProgramTransactionRequirement = "required") {
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
    dialect,
    plan: plan.plan,
    renderer: {
      id: "qubu-sqlite",
      version: 1,
      dialect,
    },
    program: {
      ...compiled.program,
      phases: compiled.program.phases.map((phase) => ({
        ...phase,
        transaction,
      })),
    },
    beforeSnapshot: { value: before },
    afterSnapshot: { value: snapshot(true) },
    approvals: [],
    provenance: { source: "unit-test" },
  })
}

test("rejects required transaction phases when the adapter declares no proven support", async () => {
  const migration = await artifact("required")
  const adapter = new DeterministicFakeMigrationAdapter({
    snapshotDigest: migration.beforeSnapshot.digest,
    capabilities: { transactions: [] },
  })

  await expect(
    executeMigrations({
      repository: [migration],
      adapter,
    }),
  ).rejects.toMatchObject({
    code: "capability",
  })
  expect(adapter.executions).toEqual([])
})

test("treats a missing transaction declaration like an empty one instead of unrestricted", async () => {
  const migration = await artifact("required")
  const adapter = new DeterministicFakeMigrationAdapter({
    snapshotDigest: migration.beforeSnapshot.digest,
    capabilities: {
      transactions: undefined,
      optionalTransactions: false,
      forbiddenPhases: "unsupported",
    },
  })

  // An omitted declaration cannot mean "every requirement is proven": an explicit empty
  // list already rejects this phase, and status reporting agrees nothing was proven.
  await expect(
    executeMigrations({
      repository: [migration],
      adapter,
    }),
  ).rejects.toMatchObject({
    code: "capability",
  })
  expect(adapter.executions).toEqual([])
})
