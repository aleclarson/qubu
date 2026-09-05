import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createClient, type Client } from "@libsql/client"
import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { completeSchemaSnapshotFingerprint } from "qubu/snapshot"
import { afterEach, expect, test, vi } from "vitest"

import {
  libsqlMigrationAdapter,
  readLibsqlMigrationSnapshot,
} from "../adapters/libsql/src/migration.ts"
import {
  sealExecutableArtifact,
  type ExecutableMigrationArtifact,
  type MigrationProgram,
  type Sha256Digest,
} from "../packages/migrate/src/artifact/index.ts"
import { compileMigrationProgram } from "../packages/migrate/src/artifact/sqlite.ts"
import { compareManagedSnapshots, createBaseline } from "../packages/migrate/src/baseline/index.ts"
import { planSchemaBootstrap } from "../packages/migrate/src/bootstrap/sqlite.ts"
import { executeMigrations } from "../packages/migrate/src/executor/index.ts"
import { createMigrationPlan } from "../packages/migrate/src/plan/index.ts"
import { readMigrationStatus } from "../packages/migrate/src/status/index.ts"
import { verifyMigrationAdapterConformance } from "../packages/migrate/src/testing/index.ts"

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
          storage: { kind: "portable", type: "text" },
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
  const compiled = compileMigrationProgram(planned.plan)
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

test("advertises atomic batch execution for the libSQL client", async () => {
  await verifyMigrationAdapterConformance({
    adapter: adapter(client()),
    expected: {
      dialect: "sqlite",
      session: "atomic-batch",
      transactionalDdl: true,
      optionalTransactions: true,
      transactions: ["required", "optional"],
      lease: true,
      leaseKind: "database",
      locks: ["none", "exclusive"],
      journal: { storage: "database", compareAndSwapHead: true, atomicAppliedAndHead: true },
      parameters: ["null", "boolean", "string", "number", "bigint", "bytes", "json"],
      commitAmbiguity: "recovery-required",
      forbiddenPhases: "unsupported",
      features: ["tagged-parameters", "journal-head-cas"],
    },
    parameterProbe: {
      sql: "SELECT ?, ?, ?, ?, ?, ?, ?",
      parameters: [
        { type: "null" },
        { type: "boolean", value: true },
        { type: "string", value: "bound" },
        { type: "number", value: "1.5" },
        { type: "bigint", value: "42" },
        { type: "bytes", base64: "AQI=" },
        { type: "json", value: { ok: true } },
      ],
    },
  })
})

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

test("sends schema changes and journal advancement through one migrate call", async () => {
  const database = client()
  const migrate = vi.spyOn(database, "migrate")
  const migration = await artifact("accounts", 0, null, [], ["accounts"])
  const result = await executeMigrations({ repository: [migration], adapter: adapter(database) })
  expect(result.applied[0]?.atomicity).toBe("atomic")
  expect(migrate).toHaveBeenCalledTimes(1)
  const statements = migrate.mock.calls[0]![0].map((statement) =>
    typeof statement === "string" ? statement : statement.sql,
  )
  expect(statements.some((sql) => sql.includes("CREATE TABLE"))).toBe(true)
  expect(statements.some((sql) => sql.includes("INSERT INTO __qubu_migration_applied"))).toBe(true)
  expect(statements.some((sql) => sql.includes("UPDATE __qubu_migration_metadata"))).toBe(true)
})

test.each(["schema", "head", "lease"] as const)(
  "rejects a stale %s inside the submitted batch",
  async (changed) => {
    const database = client()
    const migrate = database.migrate.bind(database)
    vi.spyOn(database, "migrate").mockImplementationOnce(async (statements) => {
      if (changed === "schema")
        await database.execute("CREATE TABLE concurrent_change (id INTEGER)")
      if (changed === "head")
        await database.execute("UPDATE __qubu_migration_metadata SET head = 'changed'")
      if (changed === "lease")
        await database.execute("UPDATE __qubu_migration_lease SET owner = 'other'")
      return migrate(statements)
    })
    const migration = await artifact("accounts", 0, null, [], ["accounts"])
    await expect(
      executeMigrations({ repository: [migration], adapter: adapter(database) }),
    ).rejects.toMatchObject({ code: "definite-rollback" })
    expect(await tableNames(database)).not.toContain("accounts")
    expect(
      (await database.execute("SELECT count(*) AS count FROM __qubu_migration_applied")).rows[0]
        ?.count,
    ).toBe(0)
  },
)

test("rolls back schema and journal writes when a batch postcondition fails", async () => {
  const database = client()
  const migration = await artifact("accounts", 0, null, [], ["accounts"], (program) => ({
    ...program,
    phases: program.phases.map((phase) => ({
      ...phase,
      postconditions: [{ id: "false", type: "statement", value: "SELECT 0" }],
    })),
  }))
  await expect(
    executeMigrations({ repository: [migration], adapter: adapter(database) }),
  ).rejects.toMatchObject({ code: "definite-rollback" })
  expect(await tableNames(database)).toEqual([])
  expect(
    (await database.execute("SELECT head FROM __qubu_migration_metadata")).rows[0]?.head,
  ).toBeNull()
})

test("rolls back foreign-key violations before recording success", async () => {
  const database = client()
  const migration = await artifact("accounts", 0, null, [], ["accounts"], (program) => ({
    ...program,
    phases: program.phases.map((phase) => ({
      ...phase,
      statements: [
        { ...phase.statements[0]!, sql: "CREATE TABLE accounts (value TEXT PRIMARY KEY NOT NULL)" },
        {
          ...phase.statements[0]!,
          id: "child",
          position: 1,
          sql: "CREATE TABLE child (parent_id TEXT REFERENCES accounts(value))",
        },
        {
          ...phase.statements[0]!,
          id: "orphan",
          position: 2,
          sql: "INSERT INTO child VALUES ('missing')",
        },
      ],
    })),
  }))
  await expect(
    executeMigrations({ repository: [migration], adapter: adapter(database) }),
  ).rejects.toMatchObject({ code: "definite-rollback" })
  expect(await tableNames(database)).toEqual([])
  expect(
    (await database.execute("SELECT count(*) AS count FROM __qubu_migration_applied")).rows[0]
      ?.count,
  ).toBe(0)
})

test.each([undefined, "SQLITE_IOERR"])(
  "requires recovery for an ambiguous batch error (%s)",
  async (code) => {
    const database = client()
    vi.spyOn(database, "migrate").mockRejectedValueOnce(
      Object.assign(new Error("batch outcome unknown"), { code }),
    )
    const migration = await artifact("accounts", 0, null, [], ["accounts"])
    await expect(
      executeMigrations({ repository: [migration], adapter: adapter(database) }),
    ).rejects.toMatchObject({ code: "uncertain-outcome" })
    expect((await database.execute("SELECT state FROM __qubu_migration_attempts")).rows).toEqual([
      { state: "recovery_required" },
    ])
    await expect(
      executeMigrations({ repository: [migration], adapter: adapter(database) }),
    ).rejects.toMatchObject({ code: "recovery-required" })
  },
)

test("recognizes committed history after losing the batch response", async () => {
  const database = client()
  const migrate = database.migrate.bind(database)
  vi.spyOn(database, "migrate").mockImplementationOnce(async (statements) => {
    await migrate(statements)
    throw new Error("response lost after commit")
  })
  const migration = await artifact("accounts", 0, null, [], ["accounts"])
  await expect(
    executeMigrations({ repository: [migration], adapter: adapter(database) }),
  ).rejects.toMatchObject({ code: "uncertain-outcome" })
  expect((await database.execute("SELECT state FROM __qubu_migration_attempts")).rows).toEqual([
    { state: "applied" },
  ])
  await expect(
    executeMigrations({ repository: [migration], adapter: adapter(database) }),
  ).resolves.toMatchObject({ idempotent: true, head: migration.artifactDigest })
})

test("checks column identity and schema properties without using indexed paths", async () => {
  const database = client()
  await database.execute("CREATE TABLE existing (value TEXT NOT NULL)")
  const migration = await artifact(
    "accounts",
    0,
    null,
    ["existing"],
    ["accounts", "existing"],
    (program) => ({
      ...program,
      phases: program.phases.map((phase): MigrationProgram["phases"][number] => ({
        ...phase,
        preconditions: [
          ...phase.preconditions,
          {
            id: "column",
            type: "object-present",
            value: {
              type: "object-present",
              kind: "column",
              physicalName: "value",
              path: ["tables", 9, "columns", 8],
              parent: { kind: "table", id: "logicalExisting", physicalName: "existing" },
            },
          },
          {
            id: "nullable",
            type: "property-equals",
            value: {
              type: "property-equals",
              path: ["tables", 0, "columns", 0],
              kind: "column",
              physicalName: "value",
              parent: { kind: "table", id: "existing", physicalName: "existing" },
              property: ["nullable"],
              value: false,
            },
          },
          {
            id: "fingerprint",
            type: "snapshot-fingerprint",
            value: {
              type: "snapshot-fingerprint",
              kind: "namespace",
              path: [],
              fingerprint: completeSchemaSnapshotFingerprint(snapshot(["existing"])),
            },
          },
        ],
      })),
    }),
  )
  await expect(
    executeMigrations({ repository: [migration], adapter: adapter(database) }),
  ).resolves.toMatchObject({ head: migration.artifactDigest })
})

test("rejects multiple phases before creating an attempt", async () => {
  const database = client()
  const migration = await artifact("accounts", 0, null, [], ["accounts"], (program) => ({
    ...program,
    phases: [
      ...program.phases,
      {
        ...program.phases[0]!,
        id: "second",
        position: 1,
        dependsOn: [program.phases[0]!.id],
        statements: [],
        preconditions: [],
        postconditions: [],
      },
    ],
  }))
  await expect(
    executeMigrations({ repository: [migration], adapter: adapter(database) }),
  ).rejects.toMatchObject({ code: "capability" })
  expect(
    (await database.execute("SELECT count(*) AS count FROM __qubu_migration_attempts")).rows[0]
      ?.count,
  ).toBe(0)
})

test("trusts migration SQL during batch capability validation", async () => {
  const database = { batch: vi.fn().mockResolvedValue([]) } as unknown as Client
  const session = await adapter(database).openMigrationSession()
  const migration = await artifact("accounts", 0, null, [], ["accounts"], (program) => ({
    ...program,
    phases: program.phases.map((phase) => ({
      ...phase,
      statements: [{ ...phase.statements[0]!, sql: ";COMMIT; arbitrary caller SQL" }],
      postconditions: [{ id: "custom", type: "statement", value: "PRAGMA user_version" }],
    })),
  }))
  expect(() => session.validateBatch!(migration)).not.toThrow()
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
    code: "definite-rollback",
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

test("strict snapshot reading excludes every migration journal object", async () => {
  const database = client()
  const migrationAdapter = libsqlMigrationAdapter(database)
  const session = await migrationAdapter.openMigrationSession()
  await database.execute("CREATE TABLE user_data (value TEXT NOT NULL)")
  await database.execute("CREATE TABLE __qubu_migration_future (value TEXT)")

  const inspection = await session.readSnapshot!()

  expect(inspection.snapshot.tables.map((table) => table.physicalName)).toEqual(["user_data"])
  await session.close()
})

test("bootstraps inline SQLite constraints and round trips through strict introspection", async () => {
  const database = client()
  const target: SchemaSnapshot = {
    format: "qubu-schema",
    version: 1,
    dialect,
    namingPolicy: { name: "fixture", version: 1 },
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
    tables: [
      {
        kind: "table",
        id: "accountsLogical",
        physicalName: "accounts",
        columns: [
          {
            kind: "column",
            id: "emailLogical",
            physicalName: "email_address",
            ordinalPosition: 1,
            nullable: false,
            hasDefault: false,
            generated: false,
            storage: { kind: "native", dialect: "sqlite", type: "TEXT", affinity: "text" },
          },
          {
            kind: "column",
            id: "idLogical",
            physicalName: "account_id",
            ordinalPosition: 2,
            nullable: false,
            hasDefault: false,
            generated: true,
            storage: { kind: "native", dialect: "sqlite", type: "INTEGER", affinity: "integer" },
            identity: {
              kind: "identity",
              generation: "by-default",
              options: {},
              dialect: { dialect: "sqlite", version: 1, data: { autoIncrement: false } },
            },
          },
        ],
        constraints: [
          {
            id: "emailUniqueLogical",
            kind: "unique",
            physicalName: "accounts_email_unique",
            columns: ["emailLogical"],
          },
          {
            id: "pkLogical",
            kind: "primary-key",
            physicalName: "accounts_pk",
            columns: ["idLogical"],
          },
        ],
        indexes: [],
      },
    ],
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
  const bootstrap = planSchemaBootstrap(target)
  expect(bootstrap.ok, JSON.stringify(bootstrap)).toBe(true)
  if (!bootstrap.ok) return
  const migration = await sealExecutableArtifact({
    format: "qubu-executable-migration",
    version: 1,
    id: "bootstrap",
    sequence: 0,
    parentArtifactDigest: null,
    dialect,
    plan: bootstrap.plan,
    renderer: { id: "qubu-sqlite", version: 1, dialect },
    program: bootstrap.program,
    beforeSnapshot: { value: bootstrap.beforeSnapshot },
    afterSnapshot: { value: target },
    approvals: [],
    provenance: { source: "bootstrap-test" },
  })

  await executeMigrations({ repository: [migration], adapter: libsqlMigrationAdapter(database) })
  const inspection = await readLibsqlMigrationSnapshot(database, target)

  if (inspection.snapshot.version !== 1) throw new Error("Expected a version 1 SQLite snapshot")

  const comparison = compareManagedSnapshots(target, inspection.snapshot)
  expect(comparison.matches, JSON.stringify(comparison)).toBe(true)
  expect(inspection.unmanagedObjects).toEqual([])
})

test("records a verified baseline atomically and reports unmanaged tables separately", async () => {
  const database = client()
  await database.execute("CREATE TABLE accounts (value TEXT NOT NULL)")
  const target = snapshot(["accounts"])
  const result = await createBaseline({
    adapter: libsqlMigrationAdapter(database),
    id: "existing-production",
    snapshot: target,
    provenance: { source: "schema.ts", revision: "reviewed" },
    operator: { actor: "operator@example.test" },
    verifiedAt: "2026-08-29T12:00:00.000Z",
    confirmation: {
      databaseTargetVerified: true,
      snapshotSourceVerified: true,
      zeroManagedDriftVerified: true,
      backupRestoreReady: true,
      otherMigratorsStopped: true,
      applicationCompatible: true,
      legacyHistoryCutoverAccepted: true,
    },
  })
  await database.execute("CREATE TABLE application_owned (value TEXT)")

  const status = await readMigrationStatus({
    repository: [result.artifact],
    adapter: libsqlMigrationAdapter(database),
  })

  expect(result.artifact).not.toHaveProperty("plan")
  expect(result.artifact).not.toHaveProperty("programDigest")
  expect(status.managedDrift?.matches).toBe(true)
  expect(status.unmanagedObjects).toEqual([{ kind: "table", physicalName: "application_owned" }])
})

test("refuses a baseline when logical IDs agree but physical facts differ", async () => {
  const database = client()
  await database.execute("CREATE TABLE accounts (different TEXT NOT NULL)")

  await expect(
    createBaseline({
      adapter: libsqlMigrationAdapter(database),
      id: "mismatch",
      snapshot: snapshot(["accounts"]),
      provenance: { source: "schema.ts" },
      confirmation: {
        databaseTargetVerified: true,
        snapshotSourceVerified: true,
        zeroManagedDriftVerified: true,
        backupRestoreReady: true,
        otherMigratorsStopped: true,
        applicationCompatible: true,
        legacyHistoryCutoverAccepted: true,
      },
    }),
  ).rejects.toMatchObject({ code: "drift" })
  await expect(
    database.execute("SELECT COUNT(*) AS count FROM __qubu_migration_applied"),
  ).resolves.toMatchObject({ rows: [{ count: 0 }] })
})

test("rolls back an explicit SQLite rebuild when data-copy validation fails", async () => {
  const database = client()
  await database.execute("CREATE TABLE accounts (value TEXT)")
  await database.execute("INSERT INTO accounts (value) VALUES (NULL)")
  const beforeBase = snapshot(["accounts"])
  const before: SchemaSnapshot = {
    ...beforeBase,
    tables: beforeBase.tables.map((table) => ({
      ...table,
      columns: table.columns.map((column) => ({ ...column, nullable: true })),
    })),
  }
  const after: SchemaSnapshot = {
    ...before,
    tables: before.tables.map((table) => ({
      ...table,
      columns: table.columns.map((column) => ({ ...column, nullable: false })),
    })),
  }
  const planned = createMigrationPlan(diffSnapshots(before, after), {
    allowReviewRequired: true,
    allowDestructive: true,
    allowUnsupported: true,
    allowUnknown: true,
    allowLossy: true,
  })
  expect(planned.ok).toBe(true)
  if (!planned.ok) return
  const approvals = planned.plan.operations
    .filter((operation) => operation.safety !== "safe")
    .map((operation) => ({
      operationId: operation.id,
      decision: "approve" as const,
      safety: operation.safety,
      findings: planned.plan.diagnostics
        .filter((finding) => finding.operationId === operation.id)
        .map((finding) => finding.code)
        .sort(),
      reason: "Reviewed NOT NULL rebuild",
    }))
  const compiled = compileMigrationProgram(planned.plan, {
    beforeSnapshot: before,
    afterSnapshot: after,
    approvals,
  })
  expect(compiled.ok).toBe(true)
  if (!compiled.ok) return
  const migration = await sealExecutableArtifact({
    format: "qubu-executable-migration",
    version: 1,
    id: "rebuild",
    sequence: 0,
    parentArtifactDigest: null,
    dialect,
    plan: planned.plan,
    renderer: { id: "qubu-sqlite-rebuild", version: 1, dialect },
    program: compiled.program,
    beforeSnapshot: { value: before },
    afterSnapshot: { value: after },
    approvals,
    provenance: { source: "rebuild-test" },
  })

  await expect(
    executeMigrations({
      repository: [migration],
      adapter: libsqlMigrationAdapter(database, {
        async readSnapshot() {
          return before
        },
      }),
    }),
  ).rejects.toMatchObject({ code: "definite-rollback" })
  await expect(database.execute("SELECT value FROM accounts")).resolves.toMatchObject({
    rows: [{ value: null }],
  })
  await expect(
    database.execute("SELECT state FROM __qubu_migration_attempts"),
  ).resolves.toMatchObject({ rows: [{ state: "rolled_back" }] })
})
