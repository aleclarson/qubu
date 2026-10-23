import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { expect, test } from "vitest"

import { createMigrationPlan } from "../src/plan/index.ts"

const dialect = {
  name: "neutral",
  version: 1,
} as const

function snapshot(tables: SchemaSnapshot["tables"]): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect,
    namingPolicy: {
      name: "test",
      version: 1,
    },
    namespace: {
      kind: "generic",
      name: "public",
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

function table(id: string): SchemaSnapshot["tables"][number] {
  return {
    kind: "table",
    id,
    physicalName: id,
    columns: [],
    constraints: [],
    indexes: [],
  }
}

test("requires a transaction for destructive custom SQL like every destructive operation", () => {
  const result = createMigrationPlan(diffSnapshots(snapshot([]), snapshot([table("a")])), {
    customSql: [
      {
        sql: "DROP TABLE legacy",
        dialect,
        safety: "destructive",
        reason: "Operator reviewed removal",
      },
    ],
    allowDestructive: true,
  })

  const custom = result.plan.operations.find((operation) => operation.type === "custom-sql")

  expect(custom?.safety).toBe("destructive")
  expect(custom?.transaction).toBe("required")
})

test("scopes an operation-targeted decision to its operation, not its diagnostic code", () => {
  const diff = diffSnapshots(snapshot([table("a"), table("b")]), snapshot([]))
  const blocked = createMigrationPlan(diff)

  expect(blocked.ok).toBe(false)

  const [first, second] = blocked.plan.operations

  expect(first?.status).toBe("decision-required")
  expect(second?.status).toBe("decision-required")

  const targeted = createMigrationPlan(diff, {
    decisions: [
      {
        action: "allow",
        operationId: first!.id,
        code: "destructive",
        reason: "Reviewed the first removal only",
      },
    ],
  })
  const approved = targeted.plan.operations.find((operation) => operation.id === first!.id)
  const unreviewed = targeted.plan.operations.find((operation) => operation.id === second!.id)

  expect(approved?.status).toBe("approved")
  expect(unreviewed?.status).toBe("decision-required")
  expect(targeted.ok).toBe(false)
})

test("scopes a bare operation-targeted decision to its operation", () => {
  const diff = diffSnapshots(snapshot([table("a"), table("b")]), snapshot([]))
  const blocked = createMigrationPlan(diff)
  const [first, second] = blocked.plan.operations

  const targeted = createMigrationPlan(diff, {
    decisions: [
      {
        action: "allow",
        operationId: first!.id,
        reason: "Reviewed the first removal only",
      },
    ],
  })

  expect(targeted.plan.operations.find((operation) => operation.id === first!.id)?.status).toBe(
    "approved",
  )
  expect(targeted.plan.operations.find((operation) => operation.id === second!.id)?.status).toBe(
    "decision-required",
  )
  expect(targeted.ok).toBe(false)
})
