import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  compileMigrationProgram,
  sealExecutableArtifact,
  type ExecutableMigrationArtifact,
} from "@qubu/migrate/artifact"
import type { MigrationAdapter } from "@qubu/migrate/executor"
import { createMigrationPlan } from "@qubu/migrate/plan"
import { DeterministicFakeMigrationAdapter } from "@qubu/migrate/testing"
import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
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
    ["migrate", "baseline", "initial", "--non-interactive", "--confirm", "database-target"],
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
    namespace: "main",
    tables: names.map((name) => ({
      id: name,
      physicalName: name,
      columns: [],
      constraints: [],
      indexes: [],
    })),
  }
}

function postgresSnapshot(): CompleteSchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 2,
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
