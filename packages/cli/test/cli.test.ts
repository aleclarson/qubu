import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  compileMigrationProgram,
  sealExecutableArtifact,
  type ExecutableMigrationArtifact,
} from "@qubu/migrate/artifact"
import {
  createBaseline,
  fromMigrationAdapter,
  type BaselineConfirmation,
} from "@qubu/migrate/baseline"
import type { MigrationAdapter } from "@qubu/migrate/executor"
import { createMigrationPlan } from "@qubu/migrate/plan"
import { DeterministicFakeMigrationAdapter } from "@qubu/migrate/testing"
import { diffSnapshots } from "qubu/diff"
import { decodeSchemaSnapshot, encodeSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import type { CompleteSchemaSnapshot } from "qubu/snapshot"
import { sqliteSchemaDialect } from "qubu/snapshot/sqlite"
import { afterEach, expect, test } from "vitest"

import { cliExitCodes, runCli } from "../src/cli.ts"
import type { QubuCliConfig } from "../src/config.ts"
import { FileArtifactRepository } from "../src/repository.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

test("rejects missing command arguments with the usage exit code", async () => {
  const errors: string[] = []
  const exit = await runCli(["migrate", "create"], {
    stderr: (text) => errors.push(text),
  })

  expect(exit).toBe(cliExitCodes.usage)
  expect(errors.join("")).toContain("id")
})

test.each([
  {
    files: ["qubu.config.js"],
    args: [],
    selected: "qubu.config.js",
  },
  {
    files: ["qubu.config.ts"],
    args: [],
    selected: "qubu.config.ts",
  },
  {
    files: ["qubu.config.js", "qubu.config.ts"],
    args: [],
    selected: "qubu.config.js",
  },
  {
    files: ["qubu.config.js", "qubu.config.ts"],
    args: ["--config", "qubu.config.ts"],
    selected: "qubu.config.ts",
  },
  {
    files: ["qubu.config.ts"],
    args: ["--config", "qubu.config.js"],
    selected: "qubu.config.js",
  },
  {
    files: ["qubu.config.js", "qubu.config.ts", "custom.config.js"],
    args: ["--config", "custom.config.js"],
    selected: "custom.config.js",
  },
  {
    files: [],
    args: [],
    selected: "qubu.config.js",
  },
])("selects $selected with files $files and arguments $args", async ({ files, args, selected }) => {
  const cwd = await temporaryDirectory()

  for (const file of files) {
    await writeFile(join(cwd, file), "")
  }

  const loaded: string[] = []
  const exit = await runCli(["migrate", "verify", ...args], {
    cwd,
    loadConfig: async (path) => {
      loaded.push(path)
      return { artifacts: "migrations" }
    },
    stdout: () => {},
  })

  expect(exit).toBe(0)
  expect(loaded).toEqual([join(cwd, selected)])
})

test("validates application configuration before accessing artifacts", async () => {
  const errors: string[] = []
  const exit = await runCli(["migrate", "verify", "--format", "json"], {
    loadConfig: async () => ({ artifacts: "" }),
    stderr: (text) => errors.push(text),
  })

  expect(exit).toBe(cliExitCodes.validation)
  expect(JSON.parse(errors.join(""))).toMatchObject({
    error: {
      code: "validation",
      exitCode: cliExitCodes.validation,
    },
    ok: false,
  })
})

test("renders stable JSON for repository verification", async () => {
  const cwd = await temporaryDirectory()
  const output: string[] = []
  const config = { artifacts: "migrations" } satisfies QubuCliConfig
  const exit = await runCli(["migrate", "verify", "--format", "json"], {
    cwd,
    loadConfig: async () => config,
    stdout: (text) => output.push(text),
  })

  expect(exit).toBe(0)
  expect(output.join("")).toBe('{"artifacts":0,"command":"migrate verify","head":null,"ok":true}\n')
})

test("applies every pending artifact instead of a changed-file subset", async () => {
  const cwd = await temporaryDirectory()
  const repository = new FileArtifactRepository("migrations", cwd)
  const artifacts = await noOpChain(2)

  for (const artifact of artifacts) {
    await repository.write(artifact)
  }

  const fake = new DeterministicFakeMigrationAdapter({
    snapshotDigest: artifacts[0]!.beforeSnapshot.digest,
  })
  const adapter: MigrationAdapter = {
    async openMigrationSession(signal) {
      const session = await fake.openMigrationSession(signal)

      return {
        ...session,
        async currentSnapshotDigest() {
          const applied = await fake.journal.listApplied()

          return artifacts[applied.length]!.beforeSnapshot.digest
        },
      }
    },
  }
  const output: string[] = []
  const exit = await runCli(["migrate", "apply", "--format", "json", "--non-interactive"], {
    cwd,
    loadConfig: async () => ({
      artifacts: "migrations",
      adapter: () => adapter,
    }),
    stdout: (text) => output.push(text),
  })

  expect(exit).toBe(0)
  expect(JSON.parse(output.join("")).applied).toHaveLength(2)
  expect((await fake.journal.listApplied()).map((item) => item.artifactId)).toEqual([
    "migration-0",
    "migration-1",
  ])
})

test("requires all seven baseline facts without prompting", async () => {
  const cwd = await temporaryDirectory()
  const errors: string[] = []
  const exit = await runCli(
    [
      "migrate",
      "baseline",
      "initial",
      "--candidate",
      "candidate.json",
      "--non-interactive",
      "--confirm",
      "database-target",
    ],
    {
      cwd,
      loadConfig: async () => ({ artifacts: "migrations" }),
      stderr: (text) => errors.push(text),
    },
  )

  expect(exit).toBe(cliExitCodes.policy)
  expect(errors.join("")).toContain("all seven")
})

test("dry-runs a complete PostgreSQL bootstrap with enums in dependency order", async () => {
  const output: string[] = []
  const exit = await runCli(
    ["schema", "bootstrap", "--dry-run", "--format", "json", "--non-interactive"],
    {
      loadConfig: async () => ({
        artifacts: "migrations",
        snapshot: postgresSnapshot(),
      }),
      stdout: (text) => output.push(text),
    },
  )

  expect(exit).toBe(0)
  const result = JSON.parse(output.join(""))
  expect(
    result.phases.flatMap((phase: { statements: { sql: string }[] }) =>
      phase.statements.map((statement) => statement.sql),
    ),
  ).toEqual([
    `CREATE TYPE "public"."account_role" AS ENUM ('member', 'owner')`,
    `CREATE TABLE "public"."accounts" ("role" account_role NOT NULL)`,
  ])
})

test("redacts credentials from failures and returns an adapter exit code", async () => {
  const cwd = await temporaryDirectory()
  const errors: string[] = []
  const exit = await runCli(["migrate", "status", "--format", "json"], {
    cwd,
    loadConfig: async () => ({
      artifacts: "migrations",
      adapter() {
        throw new Error("connect https://alice:hunter2@example.test/db?token=visible")
      },
    }),
    stderr: (text) => errors.push(text),
  })

  expect(exit).toBe(cliExitCodes.adapter)
  expect(errors.join("")).not.toContain("hunter2")
  expect(errors.join("")).not.toContain("alice")
  expect(errors.join("")).not.toContain("visible")
  expect(errors.join("")).toContain("[REDACTED]")
})

const baselineFacts = [
  "database-target",
  "snapshot-source",
  "zero-managed-drift",
  "backup-restore-ready",
  "other-migrators-stopped",
  "incompatible-application-prevented",
  "legacy-history-cutover",
].flatMap((fact) => ["--confirm", fact])

async function baselineFixture() {
  const cwd = await temporaryDirectory()
  const live = snapshot(["game"])
  const scope: SchemaSnapshot = {
    ...live,
    tables: live.tables.map((table) => ({
      ...table,
      columns: [
        {
          kind: "column",
          id: "manifest",
          physicalName: "manifest",
          ordinalPosition: 1,
          nullable: true,
          hasDefault: false,
          generated: false,
          storage: {
            kind: "native",
            dialect: "sqlite",
            type: "TEXT",
          },
        },
      ],
    })),
  }
  const fake = new DeterministicFakeMigrationAdapter({ snapshotDigest: `sha256:${"0".repeat(64)}` })
  const state = {
    live,
    failInspection: false,
    reads: [] as (SchemaSnapshot | undefined)[],
  }
  const config: QubuCliConfig = {
    artifacts: "migrations",
    snapshot: scope,
    environment: "test",
    adapter: () => ({
      async openMigrationSession() {
        return {
          ...(await fake.openMigrationSession()),
          async readSnapshot(expected) {
            state.reads.push(expected)
            if (state.failInspection) {
              throw new Error("Strict SQLite introspection failed: unsupported column fact")
            }

            return {
              snapshot: state.live,
              unmanagedObjects: [
                {
                  kind: "table",
                  physicalName: "external",
                },
              ],
            }
          },
        }
      },
    }),
  }
  const run = async (args: string[]) => {
    const output: string[] = []
    const errors: string[] = []
    const exit = await runCli(["migrate", ...args, "--format", "json"], {
      cwd,
      loadConfig: async () => config,
      stdout: (text) => output.push(text),
      stderr: (text) => errors.push(text),
    })

    return {
      exit,
      result: JSON.parse((exit ? errors : output).join("")),
    }
  }

  return {
    cwd,
    scope,
    fake,
    state,
    run,
    repository: new FileArtifactRepository("migrations", cwd),
  }
}

test("captures live facts and exclusions without copying a missing desired column", async () => {
  const { cwd, scope, fake, state, run, repository } = await baselineFixture()
  const result = await run(["baseline-capture", "--out", "candidate.json"])

  expect(result.exit).toBe(0)
  expect(result.result).toMatchObject({
    includedTables: ["game"],
    managedTables: ["game"],
    unmanagedObjects: [
      {
        kind: "table",
        physicalName: "external",
      },
    ],
    connectionSelector: {
      environment: "test",
      dialect: "sqlite",
      namespace: "main",
    },
  })
  const candidate = decodeSchemaSnapshot(await readFile(join(cwd, "candidate.json"), "utf8"))

  expect(candidate.ok && candidate.value.tables[0]!.columns).toEqual([])
  expect(state.reads).toEqual([scope])
  expect(await repository.list()).toEqual([])
  expect(await fake.journal.listAttempts()).toEqual([])
  expect(fake.executions).toEqual([])
  expect((await run(["baseline-capture", "--out", "candidate.json"])).exit).not.toBe(0)
  expect((await run(["baseline-capture", "--out", "migrations/candidate.json"])).exit).toBe(
    cliExitCodes.policy,
  )
})

test("preflights and accepts a candidate while leaving desired differences for the next migration", async () => {
  const { cwd, scope, fake, state, run, repository } = await baselineFixture()

  await run(["baseline-capture", "--out", "candidate.json"])
  expect(
    (await run(["baseline", "initial", "--candidate", "candidate.json", "--dry-run"])).exit,
  ).toBe(0)
  expect(await repository.list()).toEqual([])
  expect(await fake.journal.listApplied()).toEqual([])
  expect(await fake.journal.listAttempts()).toEqual([])
  expect(
    (await run(["baseline", "initial", "--candidate", "candidate.json", ...baselineFacts])).exit,
  ).toBe(0)
  expect(state.reads).toEqual([scope, scope, scope])
  const [baseline] = (await repository.list()).map((value) => JSON.parse(value))

  expect(baseline.snapshot.value.tables[0].columns).toEqual([])
  expect(baseline).not.toHaveProperty("program")
  expect((await fake.journal.listApplied())[0]?.kind).toBe("baseline")
  const next = await run(["create", "add-manifest"])

  expect(next.exit, JSON.stringify(next.result)).toBe(0)
  const artifacts = (await repository.list()).map((value) => JSON.parse(value))

  expect(artifacts[1].beforeSnapshot.value.tables[0].columns).toEqual([])
  expect(artifacts[1].afterSnapshot.value.tables[0].columns[0].physicalName).toBe("manifest")
  expect(await readFile(join(cwd, "candidate.json"), "utf8")).toBe(encodeSchemaSnapshot(state.live))
})

test("rejects changed live schema in both preflight and acceptance with comparison evidence", async () => {
  const { scope, fake, state, run, repository } = await baselineFixture()

  await run(["baseline-capture", "--out", "candidate.json"])
  state.live = scope
  for (const flags of [["--dry-run"], baselineFacts]) {
    const result = await run(["baseline", "initial", "--candidate", "candidate.json", ...flags])

    expect(result.exit).toBe(cliExitCodes.drift)
    expect(result.result.error.details.comparison.operations.length).toBeGreaterThan(0)
    expect(result.result.error.details.actualSnapshot.tables[0].columns[0].physicalName).toBe(
      "manifest",
    )
  }

  expect(await repository.list()).toEqual([])
  expect(await fake.journal.listAttempts()).toEqual([])
})

test("rereads the original scope when a previously absent managed table appears", async () => {
  const { fake, state, scope, run } = await baselineFixture()

  state.live = snapshot()
  await run(["baseline-capture", "--out", "candidate.json"])
  state.live = scope
  const result = await run([
    "baseline",
    "initial",
    "--candidate",
    "candidate.json",
    ...baselineFacts,
  ])

  expect(result.exit).toBe(cliExitCodes.drift)
  expect(state.reads).toEqual([scope, scope])
  expect(await fake.journal.listAttempts()).toEqual([])
})

test("rejects changed SQLite dialect facts even when managed comparison reports a match", async () => {
  const { fake, state, run } = await baselineFixture()

  await run(["baseline-capture", "--out", "candidate.json"])
  state.live = {
    ...state.live,
    tables: state.live.tables.map((table) => ({
      ...table,
      dialect: {
        dialect: "sqlite",
        version: 1,
        data: { strict: true },
      },
    })),
  }
  const result = await run([
    "baseline",
    "initial",
    "--candidate",
    "candidate.json",
    ...baselineFacts,
  ])

  expect(result.exit).toBe(cliExitCodes.drift)
  expect(result.result.error.details.actualSnapshot.tables[0].dialect.data.strict).toBe(true)
  expect(await fake.journal.listAttempts()).toEqual([])
})

test("rejects candidates containing tables outside the supplied scope", async () => {
  const { cwd, fake, run } = await baselineFixture()

  await writeFile(join(cwd, "candidate.json"), encodeSchemaSnapshot(snapshot(["outside"])))
  const result = await run(["baseline", "initial", "--candidate", "candidate.json", "--dry-run"])

  expect(result.exit).toBe(cliExitCodes.policy)
  expect(result.result.error.details.tables).toEqual(["outside"])
  expect(await fake.journal.listAttempts()).toEqual([])
})

test("enforces acceptance acknowledgments for untyped migration API callers", async () => {
  const { scope, fake } = await baselineFixture()

  await expect(
    createBaseline({
      adapter: fromMigrationAdapter(fake),
      scope,
      candidate: scope,
      repository: [],
      id: "initial",
      provenance: { source: "reviewed" },
      confirmation: {} as BaselineConfirmation,
    }),
  ).rejects.toMatchObject({ code: "policy" })
  expect(fake.events).toEqual([])
})

test("rejects nonempty journal history during preflight", async () => {
  const { fake, run } = await baselineFixture()

  await run(["baseline-capture", "--out", "candidate.json"])
  await fake.journal.createAttempt({
    id: "previous",
    artifactId: "old",
    artifactDigest: `sha256:${"0".repeat(64)}`,
    expectedHead: null,
    state: "started",
    startedAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
  })
  const result = await run(["baseline", "initial", "--candidate", "candidate.json", "--dry-run"])

  expect(result.exit).toBe(cliExitCodes.policy)
  expect(result.result.error.message).toContain("empty migration journal")
  expect(await fake.journal.listApplied()).toEqual([])
})

test("blocks capture and preflight when strict inspection fails", async () => {
  const { fake, state, run, repository } = await baselineFixture()

  await run(["baseline-capture", "--out", "candidate.json"])
  state.failInspection = true
  for (const args of [
    ["baseline-capture", "--out", "failed.json"],
    ["baseline", "initial", "--candidate", "candidate.json", "--dry-run"],
    ["baseline", "initial", "--candidate", "candidate.json", ...baselineFacts],
  ]) {
    const result = await run(args)

    expect(result.exit).toBe(cliExitCodes.adapter)
    expect(result.result.error.message).toContain("Strict SQLite introspection failed")
  }

  expect(await repository.list()).toEqual([])
  expect(await fake.journal.listAttempts()).toEqual([])
  expect(fake.events.filter((event) => event === "close-session")).toHaveLength(4)
})

test("rejects invalid candidates and nonempty artifact repositories before recording", async () => {
  const { cwd, fake, run, repository } = await baselineFixture()

  await writeFile(join(cwd, "bad.json"), "{}")
  expect((await run(["baseline", "initial", "--candidate", "bad.json", "--dry-run"])).exit).toBe(
    cliExitCodes.validation,
  )
  await run(["baseline-capture", "--out", "candidate.json"])
  await repository.write((await noOpChain(1))[0]!)
  expect(
    (await run(["baseline", "initial", "--candidate", "candidate.json", ...baselineFacts])).exit,
  ).toBe(cliExitCodes.policy)
  expect(await fake.journal.listAttempts()).toEqual([])
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "qubu-cli-test-"))

  temporaryDirectories.push(path)
  return path
}

function snapshot(names: readonly string[] = []): SchemaSnapshot {
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
    tables: names.map((name) => ({
      kind: "table" as const,
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

function postgresSnapshot(): CompleteSchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect: { name: "postgresql", version: 1 },
    namingPolicy: { name: "introspected-physical", version: 1 },
    namespace: { kind: "postgres-schema", name: "public" },
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
        id: "accounts",
        physicalName: "accounts",
        columns: [
          {
            kind: "column",
            id: "role",
            physicalName: "role",
            ordinalPosition: 1,
            nullable: false,
            hasDefault: false,
            generated: false,
            storage: { kind: "native", dialect: "postgresql", type: "account_role" },
          },
        ],
        constraints: [],
        indexes: [],
      },
    ],
    views: [],
    sequences: [],
    enums: [
      {
        kind: "enum",
        id: "account-role",
        physicalName: "account_role",
        values: [
          { value: "member", ordinalPosition: 1 },
          { value: "owner", ordinalPosition: 2 },
        ],
      },
    ],
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

async function noOpChain(count: number): Promise<ExecutableMigrationArtifact[]> {
  const result: ExecutableMigrationArtifact[] = []

  for (let sequence = 0; sequence < count; sequence++) {
    const before = snapshot(Array.from({ length: sequence }, (_, index) => `table_${index}`))
    const after = snapshot(Array.from({ length: sequence + 1 }, (_, index) => `table_${index}`))
    const planned = createMigrationPlan(diffSnapshots(before, after))

    if (!planned.ok) {
      throw new Error("fixture plan failed")
    }

    const compiled = compileMigrationProgram(planned.plan, sqliteSchemaDialect)

    if (!compiled.ok) {
      throw new Error("fixture program failed")
    }

    result.push(
      await sealExecutableArtifact({
        format: "qubu-executable-migration",
        version: 1,
        id: `migration-${sequence}`,
        sequence,
        parentArtifactDigest: result.at(-1)?.artifactDigest ?? null,
        dialect: after.dialect,
        plan: planned.plan,
        renderer: {
          id: "qubu-sqlite",
          version: 1,
          dialect: after.dialect,
        },
        program: compiled.program,
        beforeSnapshot: { value: before },
        afterSnapshot: { value: after },
        approvals: [],
        provenance: { source: "test" },
      }),
    )
  }

  return result
}

test("uses configured column order and lets CLI flags override it for creation and bootstrap", async () => {
  const source = postgresSnapshot()
  const template = source.tables[0]!.columns[0]!
  const target: SchemaSnapshot = {
    ...source,
    enums: [],
    tables: [
      {
        ...source.tables[0]!,
        columns: [
          {
            ...template,
            id: "flag",
            physicalName: "flag",
            ordinalPosition: 1,
            storage: {
              kind: "portable",
              type: "boolean",
            },
          },
          {
            ...template,
            id: "count",
            physicalName: "count",
            ordinalPosition: 2,
            storage: {
              kind: "portable",
              type: "integer",
            },
          },
        ],
      },
    ],
  }
  const decoded = decodeSchemaSnapshot(
    JSON.stringify({
      ...target,
      tables: target.tables.map((table) => ({
        ...table,
        columns: [...table.columns].sort((a, b) => a.id.localeCompare(b.id)),
      })),
    }),
  )

  if (!decoded.ok) {
    throw new Error(JSON.stringify(decoded.diagnostics))
  }
  for (const override of [undefined, "declaration"] as const) {
    const cwd = await temporaryDirectory()
    const config: QubuCliConfig = {
      artifacts: "migrations",
      snapshot: decoded.value,
      columnOrder: "alignment",
    }
    const flags = override ? ["--column-order", override] : []
    const output: string[] = []
    const errors: string[] = []
    const runtime = {
      cwd,
      loadConfig: async () => config,
      stdout: (text: string) => output.push(text),
      stderr: (text: string) => errors.push(text),
    }

    expect(
      await runCli(["schema", "bootstrap", "--dry-run", "--format", "json", ...flags], runtime),
      errors.join(""),
    ).toBe(0)
    const sql = JSON.parse(output.join("")).phases[0].statements[0].sql as string

    expect(sql.indexOf('"count"') < sql.indexOf('"flag"')).toBe(!override)
    output.length = 0
    expect(
      await runCli(["migrate", "create", "ordered", "--format", "json", ...flags], runtime),
      errors.join(""),
    ).toBe(0)
    const repository = new FileArtifactRepository("migrations", cwd)
    const artifacts = await repository.list()

    expect(artifacts).toHaveLength(1)
    const artifact = JSON.parse(artifacts[0]!)

    expect(artifact.program.phases[0].statements[0].sql).toBe(sql)
    const columns = artifact.afterSnapshot.value.tables[0].columns as {
      id: string
      ordinalPosition: number
    }[]

    expect(columns.find((column) => column.id === "count")!.ordinalPosition).toBe(override ? 2 : 1)
    output.length = 0
    expect(
      await runCli(
        ["migrate", "create", "repeat", "--format", "json", "--column-order", "declaration"],
        runtime,
      ),
      errors.join(""),
    ).toBe(0)
    const repeated = JSON.parse((await repository.list())[1]!)

    expect(repeated.program.phases).toEqual([])
    expect(repeated.afterSnapshot.digest).toBe(artifact.afterSnapshot.digest)
  }
})

test("rejects alignment configuration for SQLite bootstrap", async () => {
  const errors: string[] = []
  const exit = await runCli(["schema", "bootstrap", "--dry-run", "--format", "json"], {
    loadConfig: async () => ({
      artifacts: "migrations",
      snapshot: snapshot(),
      columnOrder: "alignment",
    }),
    stderr: (text) => errors.push(text),
  })

  expect(exit).not.toBe(0)
  expect(errors.join("")).toContain("only for PostgreSQL")
})
