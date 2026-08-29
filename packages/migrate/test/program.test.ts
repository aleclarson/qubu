import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { expect, test } from "vitest"

import {
  compileSqliteMigrationProgram,
  sealExecutableArtifact,
  type CustomProgramSubstitution,
  type OperationApproval,
} from "../src/artifact/index.ts"
import { createMigrationPlan, type MigrationPlan } from "../src/plan/index.ts"

const dialect = { name: "sqlite", version: 1 } as const

function snapshot(tables: SchemaSnapshot["tables"] = []): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect,
    namingPolicy: { name: "test", version: 1 },
    namespace: "main",
    tables,
  }
}

function table(id: string, columns: SchemaSnapshot["tables"][number]["columns"] = []) {
  return { id, physicalName: id, columns, constraints: [], indexes: [] }
}

function column(id: string) {
  return {
    id,
    physicalName: id,
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
  const result = compileSqliteMigrationProgram(plan)

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.program).toMatchObject({
    format: "qubu-migration-program",
    version: 1,
  })
  expect(result.program.phases.map((phase) => phase.position)).toEqual([0, 1])
  expect(
    result.program.phases.map((phase) => phase.statements.map((statement) => statement.position)),
  ).toEqual([[0], [0]])
  expect(result.program.phases[1]?.dependsOn).toEqual(["phase-0"])
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
    compileSqliteMigrationProgram(plan, {
      approvals: [approvalFor(plan, "approve")],
      customPrograms: [customProgram],
    }),
  ).toMatchObject({ ok: false })

  const result = compileSqliteMigrationProgram(plan, {
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
  const result = compileSqliteMigrationProgram(requiredPlan, {
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
  const result = compileSqliteMigrationProgram(plan, {
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
