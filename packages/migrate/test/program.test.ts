import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { expect, test } from "vitest"

import {
  sealExecutableArtifact,
  type CustomProgramSubstitution,
  type OperationApproval,
  validateMigrationProgram,
} from "../src/artifact/index.ts"
import { compileMigrationProgram } from "../src/artifact/sqlite.ts"
import { createMigrationPlan, type MigrationPlan } from "../src/plan/index.ts"

const dialect = { name: "sqlite", version: 1 } as const

function snapshot(tables: SchemaSnapshot["tables"] = []): SchemaSnapshot {
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
    tables,
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

test("rejects forward dependencies in standalone programs", () => {
  const program = {
    format: "qubu-migration-program",
    version: 1,
    phases: [
      {
        id: "first",
        position: 0,
        transaction: "optional",
        lock: "none",
        dependsOn: ["later"],
        statements: [],
        preconditions: [],
        postconditions: [],
      },
      {
        id: "later",
        position: 1,
        transaction: "optional",
        lock: "none",
        dependsOn: [],
        statements: [],
        preconditions: [],
        postconditions: [],
      },
    ],
  }
  expect(validateMigrationProgram(program)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "invalid-value",
        path: ["program", "phases", 0, "dependsOn"],
      }),
    ]),
  )
})

function table(id: string, columns: SchemaSnapshot["tables"][number]["columns"] = []) {
  return { kind: "table" as const, id, physicalName: id, columns, constraints: [], indexes: [] }
}

function column(id: string): SchemaSnapshot["tables"][number]["columns"][number] {
  return {
    kind: "column",
    id,
    physicalName: id,
    ordinalPosition: 1,
    nullable: false,
    hasDefault: false,
    generated: false,
    storage: { kind: "portable" as const, type: "text" },
  }
}

function creationPlan(): MigrationPlan {
  const result = createMigrationPlan(
    diffSnapshots(snapshot(), snapshot([table("accounts", [column("name")])])),
  )
  if (!result.ok) throw new Error("Expected safe creation plan")
  return result.plan
}

function customPlan(): MigrationPlan {
  const result = createMigrationPlan(diffSnapshots(snapshot(), snapshot()), {
    customSql: [
      {
        sql: "SELECT ?",
        dialect,
        safety: "safe",
        reason: "Application-owned data verification",
      },
    ],
  })
  if (!result.ok) throw new Error("Expected explicit custom SQL plan")
  return result.plan
}

function approvalFor(
  plan: MigrationPlan,
  decision: OperationApproval["decision"],
): OperationApproval {
  const operation = plan.operations[0]!
  return {
    operationId: operation.id,
    decision,
    safety: operation.safety,
    findings: plan.diagnostics
      .filter((finding) => finding.operationId === operation.id)
      .map((finding) => finding.code)
      .sort(),
    reason: "Reviewed exact program",
  }
}

test("compiles a plan into contiguous authoritative phases and statements", () => {
  const plan = creationPlan()
  const result = compileMigrationProgram(plan)

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.program).toMatchObject({
    format: "qubu-migration-program",
    version: 1,
  })
  expect(result.program.phases.map((phase) => phase.position)).toEqual([0])
  expect(
    result.program.phases.map((phase) => phase.statements.map((statement) => statement.position)),
  ).toEqual([[0]])
  expect(result.program.phases[0]?.statements[0]).toMatchObject({
    operationId: plan.operations.find((operation) => operation.kind === "table")?.id,
    sql: 'CREATE TABLE "main"."accounts" ("name" TEXT NOT NULL)',
    parameters: [],
  })
  expect(result.program.phases[0]?.transaction).toBe("optional")
  expect(result.program.phases[0]?.lock).toBe("exclusive")
  expect("sql" in result.program).toBe(false)
})

test("requires exact custom-program approval and preserves tagged parameters and provenance", async () => {
  const plan = customPlan()
  const operationId = plan.operations[0]!.id
  const customProgram: CustomProgramSubstitution = {
    operationId,
    source: "application-migration",
    reason: "Qubu does not own this statement",
    revision: "abc123",
    transaction: "required",
    lock: "exclusive",
    statements: [
      {
        sql: "SELECT ?",
        parameters: [{ type: "bigint", value: "42" }],
      },
    ],
  }

  expect(
    compileMigrationProgram(plan, {
      approvals: [approvalFor(plan, "approve")],
      customPrograms: [customProgram],
    }),
  ).toMatchObject({ ok: false })

  const result = compileMigrationProgram(plan, {
    approvals: [approvalFor(plan, "custom-program")],
    customPrograms: [customProgram],
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.program.phases[0]).toMatchObject({
    transaction: "required",
    lock: "exclusive",
    statements: [{ operationId, parameters: [{ type: "bigint", value: "42" }] }],
  })
  expect(result.customPrograms).toEqual([
    {
      operationId,
      source: "application-migration",
      reason: "Qubu does not own this statement",
      revision: "abc123",
    },
  ])

  await expect(
    sealExecutableArtifact({
      format: "qubu-executable-migration",
      version: 1,
      id: "custom-program",
      sequence: 0,
      parentArtifactDigest: null,
      dialect,
      plan,
      renderer: { id: "qubu-sqlite", version: 1, dialect },
      program: result.program,
      beforeSnapshot: { value: snapshot() },
      afterSnapshot: { value: snapshot() },
      approvals: [approvalFor(plan, "custom-program")],
      customPrograms: result.customPrograms,
      provenance: { source: "unit-test" },
    }),
  ).resolves.toMatchObject({ id: "custom-program" })
})

test("compiles SQLite table rebuilds into explicit copy and swap statements", () => {
  const before = snapshot([table("accounts", [column("name")])])
  const after = snapshot([
    {
      ...table("accounts", [{ ...column("name"), nullable: true }]),
      constraints: [
        {
          id: "name_unique",
          kind: "unique" as const,
          physicalName: "accounts_name_unique",
          columns: ["name"],
        },
      ],
    },
  ])
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
      reason: "Reviewed rebuild",
    }))

  const result = compileMigrationProgram(planned.plan, {
    beforeSnapshot: before,
    afterSnapshot: after,
    approvals,
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.program.phases).toHaveLength(1)
  expect(result.program.phases[0]).toMatchObject({ transaction: "required", lock: "exclusive" })
  expect(result.program.phases[0]?.statements.map((statement) => statement.sql)).toEqual([
    expect.stringContaining('CREATE TABLE "main"."__qubu_rebuild_accounts"'),
    'INSERT INTO "main"."__qubu_rebuild_accounts" ("name") SELECT "name" FROM "main"."accounts"',
    'DROP TABLE "main"."accounts"',
    'ALTER TABLE "main"."__qubu_rebuild_accounts" RENAME TO "accounts"',
  ])
  expect(result.program.phases[0]?.postconditions).toEqual([
    expect.objectContaining({ type: "object-present" }),
  ])
})

test("rejects custom transaction conflicts instead of weakening requirements", () => {
  const plan = customPlan()
  const operationId = plan.operations[0]!.id
  const requiredPlan = {
    ...plan,
    operations: plan.operations.map((operation) => ({
      ...operation,
      transaction: "required" as const,
    })),
  }
  const result = compileMigrationProgram(requiredPlan, {
    approvals: [approvalFor(requiredPlan, "custom-program")],
    customPrograms: [
      {
        operationId,
        source: "unit-test",
        reason: "Exercise conservative resolution",
        transaction: "forbidden",
        lock: "none",
        statements: [{ sql: "SELECT 1" }],
      },
    ],
  })

  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("transaction-conflict")
})

test("rejects malformed tagged custom parameters before producing a program", () => {
  const plan = customPlan()
  const operationId = plan.operations[0]!.id
  const result = compileMigrationProgram(plan, {
    approvals: [approvalFor(plan, "custom-program")],
    customPrograms: [
      {
        operationId,
        source: "unit-test",
        reason: "Exercise parameter validation",
        transaction: "optional",
        lock: "shared",
        statements: [
          {
            sql: "SELECT ?",
            parameters: [{ type: "number", value: "NaN" }],
          },
        ],
      },
    ],
  })

  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.diagnostics[0]?.path).toEqual([
    "program",
    "phases",
    0,
    "statements",
    0,
    "parameters",
    0,
    "value",
  ])
})
