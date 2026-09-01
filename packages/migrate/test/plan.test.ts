import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot } from "qubu/snapshot"
import { expect, test } from "vitest"

import {
  assertMigrationPlan,
  createMigrationPlan,
  decodeMigrationPlan,
  encodeMigrationPlan,
  migrationPlanFingerprint,
} from "../src/plan/index.ts"
import type { MigrationDecision, MigrationPlan } from "../src/plan/index.ts"

function snapshot(
  tables: SchemaSnapshot["tables"],
  dialect: SchemaSnapshot["dialect"] = {
    name: "neutral",
    version: 1,
  },
): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 2,
    dialect,
    namingPolicy: {
      name: "test",
      version: 1,
    },
    namespace: { kind: "generic", name: "public" },
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

function table(
  id: string,
  columns: SchemaSnapshot["tables"][number]["columns"] = [],
): SchemaSnapshot["tables"][number] {
  return {
    kind: "table",
    id,
    physicalName: id,
    columns,
    constraints: [],
    indexes: [],
  }
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
  }
}

function allowUnsafe(plan: MigrationPlan): readonly MigrationDecision[] {
  return plan.operations
    .filter((operation) => operation.status === "decision-required")
    .map((operation) => ({
      operationId: operation.id,
      action: "allow" as const,
      reason: "Reviewed by the migration owner",
    }))
}

test("orders parent creation before child creation", () => {
  const diff = diffSnapshots(snapshot([]), snapshot([table("accounts", [column("id")])]))
  const result = createMigrationPlan(diff)

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  const tableOperation = result.plan.operations.find((operation) => operation.kind === "table")!
  const columnOperation = result.plan.operations.find((operation) => operation.kind === "column")!

  expect(tableOperation.position).toBeLessThan(columnOperation.position)
  expect(columnOperation.dependsOn).toContain(tableOperation.id)
  expect(result.plan.dependencies).toContainEqual({
    from: tableOperation.id,
    to: columnOperation.id,
    reason: "parent-before-child",
  })
  expect(Object.isFrozen(result.plan)).toBe(true)
  expect(Object.isFrozen(result.plan.operations)).toBe(true)
})

test("orders child removal before destructive parent removal", () => {
  const diff = diffSnapshots(snapshot([table("accounts", [column("id")])]), snapshot([]))
  const first = createMigrationPlan(diff)

  expect(first.ok).toBe(false)
  const decisions = allowUnsafe(first.plan)
  const result = createMigrationPlan(diff, { decisions })

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  const tableOperation = result.plan.operations.find((operation) => operation.kind === "table")!
  const columnOperation = result.plan.operations.find((operation) => operation.kind === "column")!

  expect(columnOperation.position).toBeLessThan(tableOperation.position)
  expect(tableOperation.dependsOn).toContain(columnOperation.id)
  expect(tableOperation.reversibility).toBe("irreversible")
})

test("requires a decision for explicit physical renames", () => {
  const diff = diffSnapshots(snapshot([table("legacy_accounts")]), snapshot([table("accounts")]), {
    renameHints: [
      {
        kind: "table",
        namespace: "public",
        from: "legacy_accounts",
        to: "accounts",
      },
    ],
  })
  const blocked = createMigrationPlan(diff)

  expect(blocked.ok).toBe(false)
  expect(blocked.plan.operations).toHaveLength(1)
  expect(blocked.plan.operations[0]?.type).toBe("physical-rename")
  expect(blocked.plan.operations[0]?.safety).toBe("review-required")

  const result = createMigrationPlan(diff, {
    decisions: allowUnsafe(blocked.plan),
  })

  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.plan.operations[0]?.origin?.type).toBe("physical-rename")
  }
})

test("keeps opaque facts blocked without inferring SQL", () => {
  const before = {
    format: "qubu-schema" as const,
    version: 2 as const,
    dialect: {
      name: "mysql",
      version: 1,
    },
    namingPolicy: {
      name: "introspected-physical",
      version: 1,
    },
    namespace: {
      kind: "mysql-database" as const,
      name: "app",
    },
    capabilities: {
      generatedColumns: true,
      identityMetadata: true,
      checkConstraints: true,
      checkConstraintEnforcement: "enforced" as const,
      expressionDecompilation: true,
      indexExpressions: true,
      indexPredicates: true,
      indexIncludedColumns: true,
      namespaces: true,
      visibility: "complete" as const,
    },
    tables: [],
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
    opaqueObjects: [
      {
        kind: "opaque-object" as const,
        id: "event:refresh",
        physicalName: "refresh",
        objectKind: "event",
        data: { sql: "CREATE EVENT refresh" },
      },
    ],
    comments: [],
    ownership: [],
  }
  const after = {
    ...before,
    opaqueObjects: [],
  }
  const diff = diffSnapshots(before, after)
  const result = createMigrationPlan(diff)

  expect(result.ok).toBe(false)
  expect(result.plan.operations.some((operation) => operation.kind === "opaque-object")).toBe(true)
  expect(result.plan.operations.some((operation) => operation.customSql !== undefined)).toBe(false)
  expect(
    result.plan.diagnostics.some((diagnostic) => diagnostic.code === "decision-required"),
  ).toBe(true)
})

test("retains explicit custom SQL as tagged data", () => {
  const diff = diffSnapshots(snapshot([]), snapshot([table("accounts")]))
  const customSql = {
    sql: "ALTER TABLE accounts VALIDATE CONSTRAINT accounts_check",
    dialect: {
      name: "neutral",
      version: 1,
    },
    safety: "review-required" as const,
    reason: "The dialect adapter owns this expression.",
    reversible: false,
    position: 7,
  }
  const blocked = createMigrationPlan(diff, { customSql: [customSql] })

  expect(blocked.ok).toBe(false)
  const custom = blocked.plan.operations.find((operation) => operation.type === "custom-sql")!

  expect(custom.customSql).toMatchObject(customSql)
  expect(custom.position).toBe(0)
  expect(custom.customSql?.position).toBe(7)
  expect(blocked.plan.operations.some((operation) => operation.path.join(".") === "opaque")).toBe(
    false,
  )
})

test("encodes deterministically and rejects malformed plans", () => {
  const diff = diffSnapshots(snapshot([]), snapshot([table("accounts")]))
  const result = createMigrationPlan(diff)

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  const encoded = encodeMigrationPlan(result.plan)
  const decoded = decodeMigrationPlan(encoded)

  expect(decoded.ok).toBe(true)
  expect(result.plan.version).toBe(2)
  expect(encoded).toContain('"beforeFingerprint"')
  expect(encoded).not.toContain('"beforeDigest"')
  expect(migrationPlanFingerprint(result.plan)).toBe(migrationPlanFingerprint(encoded))
  expect(
    decodeMigrationPlan({
      ...result.plan,
      version: 99,
    }),
  ).toMatchObject({
    ok: false,
  })
  expect(
    decodeMigrationPlan({
      ...result.plan,
      operations: result.plan.operations.map((operation) => ({
        ...operation,
        customSql: {
          sql: "ALTER TABLE accounts",
          dialect: {
            name: "neutral",
            version: 1,
          },
          safety: "safe",
          position: 0,
          reason: "",
          reversible: false,
          unexpected: true,
        },
      })),
    }),
  ).toMatchObject({ ok: false })
  expect(
    decodeMigrationPlan({
      ...result.plan,
      operations: [null],
    }),
  ).toMatchObject({ ok: false })
})

test("asserts only validated plans", () => {
  expect(() => assertMigrationPlan(null)).toThrowError()
})
