import { DatabaseSync } from "node:sqlite"

import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { afterEach, expect, test } from "vitest"

import { nodeSqliteMigrationAdapter } from "../adapters/node-sqlite/src/migration.ts"
import {
  sealExecutableArtifact,
  type Sha256Digest,
} from "../packages/migrate/src/artifact/index.ts"
import { compileMigrationProgram } from "../packages/migrate/src/artifact/sqlite.ts"
import { executeMigrations } from "../packages/migrate/src/executor/index.ts"
import { createMigrationPlan } from "../packages/migrate/src/plan/index.ts"
import { verifyMigrationAdapterConformance } from "../packages/migrate/src/testing/index.ts"

const databases: DatabaseSync[] = []
const dialect = {
  name: "sqlite",
  version: 1,
} as const

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close()
  }
})

function database(): DatabaseSync {
  const value = new DatabaseSync(":memory:")

  databases.push(value)
  return value
}

function snapshot(names: readonly string[]): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect,
    namingPolicy: {
      name: "node-sqlite-live-test",
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
    tables: names.toSorted().map((name) => ({
      kind: "table",
      id: name,
      physicalName: name,
      columns: [
        {
          kind: "column",
          id: "value",
          physicalName: "value",
          ordinalPosition: 1,
          nullable: false,
          hasDefault: false,
          generated: false,
          storage: {
            kind: "portable",
            type: "text",
          },
        },
      ],
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

function adapter(value: DatabaseSync) {
  return nodeSqliteMigrationAdapter(value, {
    async readSnapshot(connection) {
      const rows = connection
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE '__qubu_%' ORDER BY name",
        )
        .all()

      return snapshot(rows.map((row) => String(row.name)))
    },
  })
}

test("runs the shared conformance probe against a pinned node:sqlite session", async () => {
  const value = adapter(database())

  await verifyMigrationAdapterConformance({
    adapter: value,
    expected: {
      dialect: "sqlite",
      session: "pinned",
      transactionalDdl: true,
      optionalTransactions: true,
      transactions: ["required", "optional"],
      lease: true,
      leaseKind: "database",
      locks: ["none", "exclusive"],
      journal: {
        storage: "database",
        compareAndSwapHead: true,
        atomicAppliedAndHead: true,
      },
      parameters: ["null", "boolean", "string", "number", "bigint", "bytes", "json"],
      commitAmbiguity: "recovery-required",
      forbiddenPhases: "unsupported",
      features: ["tagged-parameters", "journal-head-cas"],
    },
    parameterProbe: {
      sql: "SELECT ?, ?, ?, ?, ?, ?, ?",
      parameters: [
        { type: "null" },
        {
          type: "boolean",
          value: true,
        },
        {
          type: "string",
          value: "bound",
        },
        {
          type: "number",
          value: "1.5",
        },
        {
          type: "bigint",
          value: "42",
        },
        {
          type: "bytes",
          base64: "AQI=",
        },
        {
          type: "json",
          value: { ok: true },
        },
      ],
    },
  })
})

test("applies and journals a transactional node:sqlite migration", async () => {
  const value = database()
  const before = snapshot([])
  const after = snapshot(["accounts"])
  const planned = createMigrationPlan(diffSnapshots(before, after))

  if (!planned.ok) {
    throw new Error("Migration fixture planning failed")
  }
  const compiled = compileMigrationProgram(planned.plan)

  if (!compiled.ok) {
    throw new Error("Migration fixture compilation failed")
  }
  const artifact = await sealExecutableArtifact({
    format: "qubu-executable-migration",
    version: 1,
    id: "accounts",
    sequence: 0,
    parentArtifactDigest: null,
    dialect,
    plan: planned.plan,
    renderer: {
      id: "qubu-sqlite",
      version: 1,
      dialect,
    },
    program: {
      ...compiled.program,
      phases: compiled.program.phases.map((phase) => ({
        ...phase,
        transaction: "required" as const,
      })),
    },
    beforeSnapshot: { value: before },
    afterSnapshot: { value: after },
    approvals: [],
    provenance: { source: "node-sqlite-live-test" },
  })

  await expect(
    executeMigrations({
      repository: [artifact],
      adapter: adapter(value),
    }),
  ).resolves.toMatchObject({
    idempotent: false,
    head: artifact.artifactDigest,
  })
  expect(value.prepare("SELECT COUNT(*) AS count FROM __qubu_migration_applied").get()).toEqual({
    count: 1,
  })
})

test("accepts BigInt journal change counts", async () => {
  const value = new DatabaseSync(":memory:", { readBigInts: true })
  databases.push(value)
  const session = await adapter(value).openMigrationSession()
  const artifactDigest = `sha256:${"a".repeat(64)}` as Sha256Digest
  const timestamp = "2026-01-01T00:00:00.000Z"

  await session.journal.createAttempt({
    id: "attempt-bigint",
    artifactId: "artifact-bigint",
    artifactDigest,
    expectedHead: null,
    state: "started",
    startedAt: timestamp,
    updatedAt: timestamp,
  })
  await session.journal.transitionAttempt("attempt-bigint", "running")

  expect((await session.journal.listAttempts())[0]).toMatchObject({ state: "running" })
  await expect(session.journal.compareAndSwapHead(null, artifactDigest)).resolves.toBe(true)
  await expect(session.journal.readMetadata()).resolves.toMatchObject({ head: artifactDigest })
})

test("lets close roll back a migration transaction left active after commit fails", async () => {
  const value = database()
  value.exec(
    `
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      CREATE TABLE child (
        parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED
      );
    `,
  )
  const session = await adapter(value).openMigrationSession()

  await session.beginTransaction()
  await session.execute("INSERT INTO child (parent_id) VALUES (1)", [])
  await expect(session.commitTransaction()).rejects.toMatchObject({
    code: "ERR_SQLITE_ERROR",
  })
  expect(value.isTransaction).toBe(true)

  await expect(session.close()).resolves.toBeUndefined()
  expect(value.isTransaction).toBe(false)
  expect(value.prepare("SELECT COUNT(*) AS count FROM child").get()).toMatchObject({ count: 0 })
})

test("retries rollback cleanup when a failed rollback leaves the driver transaction active", async () => {
  let active = false
  let rollbackAttempts = 0
  const rollbackError = new Error("rollback failed")
  const value = {
    get isTransaction() {
      return active
    },
    exec(sql: string) {
      if (sql === "BEGIN IMMEDIATE") {
        active = true
        return
      }
      if (sql === "ROLLBACK") {
        rollbackAttempts += 1
        if (rollbackAttempts === 1) {
          throw rollbackError
        }
        active = false
      }
    },
  } as unknown as DatabaseSync
  const session = await nodeSqliteMigrationAdapter(value, {
    async readSnapshot() {
      return snapshot([])
    },
  }).openMigrationSession()

  await session.beginTransaction()
  await expect(session.rollbackTransaction()).rejects.toBe(rollbackError)
  expect(active).toBe(true)

  await expect(session.close()).resolves.toBeUndefined()
  expect(rollbackAttempts).toBe(2)
  expect(active).toBe(false)
})
