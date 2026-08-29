import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createClient, type Client } from "@libsql/client"
import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { afterEach, expect, test } from "vitest"

import { libsqlMigrationAdapter } from "../adapters/libsql/src/migration.ts"
import {
  compileSqliteMigrationProgram,
  sealExecutableArtifact,
  type ExecutableMigrationArtifact,
  type MigrationProgram,
  type Sha256Digest,
} from "../packages/migrate/src/artifact/index.ts"
import { executeMigrations } from "../packages/migrate/src/executor/index.ts"
import { createMigrationPlan } from "../packages/migrate/src/plan/index.ts"

const clients: Client[] = []
const directories: string[] = []
const dialect = { name: "sqlite", version: 1 } as const

afterEach(() => {
  for (const client of clients.splice(0)) client.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function client(): Client {
  const directory = mkdtempSync(join(tmpdir(), "qubu-libsql-migration-"))
  directories.push(directory)
  const value = createClient({ url: `file:${join(directory, "database.db")}` })
  clients.push(value)
  return value
}

function snapshot(names: readonly string[]): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect,
    namingPolicy: { name: "live-test", version: 1 },
    namespace: "main",
    tables: names.toSorted().map((name) => ({
      id: name,
      physicalName: name,
      columns: [
        {
          id: "value",
          physicalName: "value",
          nullable: false,
          hasDefault: false,
          generated: false,
          storage: { kind: "portable", type: "text" },
        },
      ],
      constraints: [],
      indexes: [],
    })),
  }
}

async function artifact(
  id: string,
  sequence: number,
  parentArtifactDigest: Sha256Digest | null,
  beforeNames: readonly string[],
  afterNames: readonly string[],
  transform?: (program: MigrationProgram) => MigrationProgram,
): Promise<ExecutableMigrationArtifact> {
  const before = snapshot(beforeNames)
  const after = snapshot(afterNames)
  const planned = createMigrationPlan(diffSnapshots(before, after))
  if (!planned.ok) throw new Error("Migration fixture planning failed")
  const compiled = compileSqliteMigrationProgram(planned.plan)
  if (!compiled.ok) throw new Error("Migration fixture compilation failed")
  const program: MigrationProgram = {
    ...compiled.program,
    phases: [
      {
        ...compiled.program.phases[0]!,
        position: 0,
        transaction: "required",
        dependsOn: [],
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
    plan: planned.plan,
    renderer: { id: "qubu-sqlite", version: 1, dialect },
    program: transform?.(program) ?? program,
    beforeSnapshot: { value: before },
    afterSnapshot: { value: after },
    approvals: [],
    provenance: { source: "libsql-live-test" },
  })
}

function adapter(database: Client) {
  return libsqlMigrationAdapter(database, {
    async readSnapshot(executor) {
      const result = await executor.execute(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE '__qubu_%' ORDER BY name",
      )
      return snapshot(result.rows.map((row) => String(row.name)))
    },
  })
}

async function tableNames(database: Client): Promise<string[]> {
  const result = await database.execute(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE '__qubu_%' ORDER BY name",
  )
  return result.rows.map((row) => String(row.name))
}

test("applies an initial migration with tagged parameters and atomic journal advancement", async () => {
  const database = client()
  const migration = await artifact("accounts", 0, null, [], ["accounts"])
  const result = await executeMigrations({ repository: [migration], adapter: adapter(database) })
  const session = await adapter(database).openMigrationSession()
  await session.acquireLease()
  await session.execute("INSERT INTO accounts (value) VALUES (?)", [
    { type: "string", value: "bound" },
  ])
  await session.releaseLease()
  await session.close()

  expect(result.applied).toHaveLength(1)
  expect(await tableNames(database)).toEqual(["accounts"])
  await expect(database.execute("SELECT value FROM accounts")).resolves.toMatchObject({
    rows: [{ value: "bound" }],
  })
})

test("repeats an applied repository as a no-op", async () => {
  const database = client()
  const migration = await artifact("accounts", 0, null, [], ["accounts"])
  await executeMigrations({ repository: [migration], adapter: adapter(database) })

  await expect(
    executeMigrations({ repository: [migration], adapter: adapter(database) }),
  ).resolves.toMatchObject({
    applied: [],
    head: migration.artifactDigest,
    idempotent: true,
  })
})

test("applies a multi-artifact chain in order", async () => {
  const database = client()
  const first = await artifact("accounts", 0, null, [], ["accounts"])
  const second = await artifact(
    "audit",
    1,
    first.artifactDigest,
    ["accounts"],
    ["accounts", "audit"],
  )

  const result = await executeMigrations({
    repository: [first, second],
    adapter: adapter(database),
  })

  expect(result.applied.map((item) => item.artifactId)).toEqual(["accounts", "audit"])
  expect(await tableNames(database)).toEqual(["accounts", "audit"])
})

test("rolls back DDL and durably records a failed attempt", async () => {
  const database = client()
  const migration = await artifact("broken", 0, null, [], ["broken"], (program) => ({
    ...program,
    phases: program.phases.map((phase) => ({
      ...phase,
      statements: phase.statements.map((statement) => ({
        ...statement,
        sql: "CREATE TABL broken",
      })),
    })),
  }))

  await expect(
    executeMigrations({ repository: [migration], adapter: adapter(database) }),
  ).rejects.toMatchObject({
    code: "adapter",
  })
  expect(await tableNames(database)).toEqual([])
  const attempts = await database.execute("SELECT state FROM __qubu_migration_attempts")
  expect(attempts.rows).toEqual([{ state: "rolled_back" }])
})

test("serializes concurrent migration runners through the durable lease", async () => {
  const database = client()
  const migration = await artifact("accounts", 0, null, [], ["accounts"])
  const results = await Promise.all([
    executeMigrations({ repository: [migration], adapter: adapter(database) }),
    executeMigrations({ repository: [migration], adapter: adapter(database) }),
  ])

  expect(results.map((result) => result.idempotent).sort()).toEqual([false, true])
  const history = await database.execute("SELECT COUNT(*) AS count FROM __qubu_migration_applied")
  expect(history.rows[0]?.count).toBe(1)
})

test("rejects tampered journal history", async () => {
  const database = client()
  const migration = await artifact("accounts", 0, null, [], ["accounts"])
  await executeMigrations({ repository: [migration], adapter: adapter(database) })
  await database.execute(
    "UPDATE __qubu_migration_applied SET artifact_digest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'",
  )

  await expect(
    executeMigrations({ repository: [migration], adapter: adapter(database) }),
  ).rejects.toMatchObject({
    code: "validation",
  })
})

test("rejects live schema drift before executing a pending migration", async () => {
  const database = client()
  const migration = await artifact("accounts", 0, null, [], ["accounts"])
  await database.execute("CREATE TABLE unexpected (value TEXT NOT NULL)")

  await expect(
    executeMigrations({ repository: [migration], adapter: adapter(database) }),
  ).rejects.toMatchObject({
    code: "drift",
    retry: "safe",
  })
  expect(await tableNames(database)).toEqual(["unexpected"])
})

test("refuses transaction-forbidden phases and unsupported DDL locks before journal mutation", async () => {
  const database = client()
  const forbidden = await artifact("forbidden", 0, null, [], ["forbidden"], (program) => ({
    ...program,
    phases: program.phases.map((phase) => ({ ...phase, transaction: "forbidden" })),
  }))
  await expect(
    executeMigrations({ repository: [forbidden], adapter: adapter(database) }),
  ).rejects.toMatchObject({ code: "capability" })

  const locked = await artifact("locked", 0, null, [], ["locked"], (program) => ({
    ...program,
    phases: program.phases.map((phase) => ({ ...phase, lock: "shared" })),
  }))
  await expect(
    executeMigrations({ repository: [locked], adapter: adapter(database) }),
  ).rejects.toMatchObject({ code: "capability" })
  await expect(
    database.execute("SELECT COUNT(*) AS count FROM __qubu_migration_attempts"),
  ).resolves.toMatchObject({ rows: [{ count: 0 }] })
})
