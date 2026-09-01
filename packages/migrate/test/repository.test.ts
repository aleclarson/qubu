import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { expect, test } from "vitest"

import {
  sealExecutableArtifact,
  type MigrationProgram,
  type UnsealedExecutableMigrationArtifact,
} from "../src/artifact/index.ts"
import { InMemoryMigrationJournal } from "../src/journal/memory.ts"
import { createMigrationPlan } from "../src/plan/index.ts"
import { verifyArtifactChain, verifyRepositoryState } from "../src/repository/index.ts"

const dialect = {
  name: "sqlite",
  version: 1,
} as const

function snapshot(names: string | readonly string[] = []): SchemaSnapshot {
  const values = typeof names === "string" ? [names] : names
  return {
    format: "qubu-schema",
    version: 1,
    dialect,
    namingPolicy: {
      name: "test",
      version: 1,
    },
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
    tables: values.map((name) => ({
      kind: "table",
      id: name,
      physicalName: name,
      columns: [],
      constraints: [],
      indexes: [],
    })),
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

async function artifact(
  id: string,
  sequence: number,
  parentArtifactDigest: UnsealedExecutableMigrationArtifact["parentArtifactDigest"],
  before: SchemaSnapshot,
  after: SchemaSnapshot,
) {
  const result = createMigrationPlan(diffSnapshots(before, after))

  if (!result.ok) {
    throw new Error("fixture plan blocked")
  }

  const operationId = result.plan.operations[0]!.id
  const program: MigrationProgram = {
    format: "qubu-migration-program",
    version: 1,
    phases: [
      {
        id: "main",
        position: 0,
        transaction: "required",
        lock: "exclusive",
        dependsOn: [],
        statements: [
          {
            id: `statement-${sequence}`,
            position: 0,
            operationId,
            sql: `CREATE TABLE ${id} ()`,
            parameters: [],
            dependsOn: [],
          },
        ],
        preconditions: [],
        postconditions: [],
      },
    ],
  }

  return sealExecutableArtifact({
    format: "qubu-executable-migration",
    version: 1,
    id,
    sequence,
    parentArtifactDigest,
    dialect,
    plan: result.plan,
    renderer: {
      id: "qubu-sqlite",
      version: 1,
      dialect,
    },
    program,
    beforeSnapshot: { value: before },
    afterSnapshot: { value: after },
    approvals: [],
    provenance: { source: "unit-test" },
  })
}

test("verifies a complete digest-linked repository chain", async () => {
  const first = await artifact("create-accounts", 0, null, snapshot(), snapshot("accounts"))
  const second = await artifact(
    "create-posts",
    1,
    first.artifactDigest,
    snapshot("accounts"),
    snapshot(["accounts", "posts"]),
  )
  const result = await verifyArtifactChain([first, second])

  expect(result).toEqual({
    ok: true,
    artifacts: [first, second],
    head: second.artifactDigest,
  })
})

test("detects duplicate identities, gaps, forks, and parent mismatches", async () => {
  const first = await artifact("create-accounts", 0, null, snapshot(), snapshot("accounts"))
  const second = await artifact(
    "create-posts",
    1,
    first.artifactDigest,
    snapshot("accounts"),
    snapshot(["accounts", "posts"]),
  )
  const fork = await artifact(
    "create-comments",
    2,
    first.artifactDigest,
    snapshot("accounts"),
    snapshot(["accounts", "comments"]),
  )
  const result = await verifyArtifactChain([first, second, fork, second])
  const codes = result.ok ? [] : result.diagnostics.map((item) => item.code)

  expect(codes).toEqual(
    expect.arrayContaining(["duplicate", "sequence-gap", "fork", "parent-mismatch"]),
  )
})

test("integrates immutable journal history with repository prefix verification", async () => {
  const first = await artifact("create-accounts", 0, null, snapshot(), snapshot("accounts"))
  const second = await artifact(
    "create-posts",
    1,
    first.artifactDigest,
    snapshot("accounts"),
    snapshot(["accounts", "posts"]),
  )
  const journal = new InMemoryMigrationJournal()
  const timestamp = "2026-01-01T00:00:00.000Z"
  await journal.createAttempt({
    id: "attempt-1",
    artifactId: first.id,
    artifactDigest: first.artifactDigest,
    expectedHead: null,
    state: "started",
    startedAt: timestamp,
    updatedAt: timestamp,
  })
  await journal.transitionAttempt("attempt-1", "running")
  await journal.appendAppliedAndAdvanceHead(
    {
      artifactId: first.id,
      sequence: 0,
      artifactDigest: first.artifactDigest,
      parentArtifactDigest: null,
      kind: "migration",
      attemptId: "attempt-1",
      appliedAt: timestamp,
    },
    null,
  )
  await journal.transitionAttempt("attempt-1", "applied")

  const result = await verifyRepositoryState([first, second], journal)
  expect(result).toMatchObject({
    ok: true,
    applied: [{ artifactId: first.id, artifactDigest: first.artifactDigest }],
    pending: [second],
    head: first.artifactDigest,
  })
})
