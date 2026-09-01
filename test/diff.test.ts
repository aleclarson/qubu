import { expect, test } from "vitest"

import {
  decodeSnapshotForDiff,
  diffSnapshots,
  encodeSnapshotRenameHints,
  validateSnapshotRenameHints,
} from "../src/diff/index.ts"
import type { CompleteSchemaSnapshot } from "../src/snapshot/complete-types.ts"
import type { SchemaSnapshot } from "../src/snapshot/types.ts"

const capabilities = {
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
}

type TestColumn = Omit<
  SchemaSnapshot["tables"][number]["columns"][number],
  "kind" | "ordinalPosition"
> & {
  readonly kind?: "column"
  readonly ordinalPosition?: number
}

function tableSnapshot(tables: SchemaSnapshot["tables"], namespace = "public"): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 2,
    dialect: {
      name: "neutral",
      version: 1,
    },
    namingPolicy: {
      name: "test",
      version: 1,
    },
    namespace: { kind: "generic", name: namespace },
    capabilities,
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

function table(id: string, physicalName = id, columns: readonly TestColumn[] = []) {
  return {
    kind: "table" as const,
    id,
    physicalName,
    columns: columns.map((column, index) => ({
      kind: "column" as const,
      ordinalPosition: column.ordinalPosition ?? index + 1,
      ...column,
    })),
    constraints: [],
    indexes: [],
  }
}

function completeSnapshot(
  opaqueObjects: CompleteSchemaSnapshot["opaqueObjects"] = [],
  deferredObjects: CompleteSchemaSnapshot["deferredObjects"] = [],
): CompleteSchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 2,
    dialect: {
      name: "mysql",
      version: 1,
    },
    namingPolicy: {
      name: "introspected-physical",
      version: 1,
    },
    namespace: {
      kind: "mysql-database",
      name: "app",
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
    deferredObjects,
    opaqueObjects,
    comments: [],
    ownership: [],
  }
}

test("compares reordered canonical arrays as equal", () => {
  const before = tableSnapshot([table("accounts"), table("users")])
  const after = tableSnapshot([table("users"), table("accounts")])

  const result = diffSnapshots(before, after)

  expect(result.equal).toBe(true)
  expect(result.operations).toEqual([])
  expect(result.beforeFingerprint).toBe(result.afterFingerprint)
})

test("classifies additions, removals, and property changes", () => {
  const before = tableSnapshot([
    table("accounts", "accounts", [
      {
        id: "id",
        physicalName: "id",
        nullable: true,
        hasDefault: false,
        generated: false,
      },
    ]),
    table("removed"),
  ])
  const after = tableSnapshot([
    table("accounts", "accounts", [
      {
        id: "id",
        physicalName: "id",
        nullable: false,
        hasDefault: false,
        generated: false,
      },
    ]),
    table("added"),
  ])

  const result = diffSnapshots(before, after)

  expect(result.additions.map((operation) => operation.logicalId)).toContain("added")
  expect(result.removals.map((operation) => operation.logicalId)).toContain("removed")
  expect(result.propertyChanges.map((operation) => operation.logicalId)).toContain("id")
  expect(result.diagnostics.some((issue) => issue.code === "destructive")).toBe(true)
})

test("keeps explicit rename hints authoritative and serializable", () => {
  const before = tableSnapshot([table("legacy_accounts", "legacy_accounts")])
  const after = tableSnapshot([table("accounts", "accounts")])
  const hints = [
    {
      kind: "table" as const,
      namespace: "public",
      from: "legacy_accounts",
      to: "accounts",
    },
  ]

  const result = diffSnapshots(before, after, { renameHints: hints })

  expect(result.renames).toHaveLength(1)
  expect(result.renames[0]).toMatchObject({
    type: "physical-rename",
    source: "explicit-hint",
    before: {
      id: "legacy_accounts",
      physicalName: "legacy_accounts",
    },
    after: {
      id: "accounts",
      physicalName: "accounts",
    },
  })
  expect(result.additions).toEqual([])
  expect(result.removals).toEqual([])
  expect(encodeSnapshotRenameHints(hints)).toBe(
    '[{"from":"legacy_accounts","kind":"table","namespace":"public","to":"accounts"}]',
  )
})

test("reports structural rename suggestions without creating renames", () => {
  const columns = [
    {
      id: "id",
      physicalName: "id",
      nullable: false,
      hasDefault: false,
      generated: false,
    },
  ] as const
  const result = diffSnapshots(
    tableSnapshot([table("legacy", "legacy", columns)]),
    tableSnapshot([table("current", "current", columns)]),
  )

  expect(result.renames).toEqual([])
  expect(result.suggestions).toHaveLength(1)
  expect(result.suggestions[0]).toMatchObject({
    type: "rename-suggestion",
    before: { id: "legacy" },
    after: { id: "current" },
  })
  expect(result.operations.filter((operation) => operation.type === "remove")).not.toHaveLength(0)
  expect(result.operations.filter((operation) => operation.type === "add")).not.toHaveLength(0)
})

test("diagnoses ambiguous structural matches", () => {
  const before = tableSnapshot([table("legacy", "legacy")])
  const after = tableSnapshot([table("first", "first"), table("second", "second")])

  const result = diffSnapshots(before, after)

  expect(result.suggestions).toEqual([])
  expect(result.diagnostics.some((issue) => issue.code === "ambiguous")).toBe(true)
  expect(result.renames).toEqual([])
})

test("rejects malformed and out-of-scope rename hints", () => {
  const malformed = validateSnapshotRenameHints([
    {
      kind: "not-an-object",
      from: "old",
      to: "new",
    },
    {
      kind: "table",
      namespace: "public",
      from: {},
      to: "new",
    },
  ])

  expect(malformed.ok).toBe(false)
  expect(malformed.diagnostics.some((issue) => issue.code === "invalid-rename-hint")).toBe(true)

  const result = diffSnapshots(tableSnapshot([table("old")]), tableSnapshot([table("new")]), {
    renameHints: [
      {
        kind: "table",
        namespace: "other",
        from: "old",
        to: "new",
      },
    ],
  })

  expect(result.renames).toEqual([])
  expect(result.diagnostics.some((issue) => issue.code === "invalid-rename-hint")).toBe(true)
})

test("keeps opaque and deferred records out of automatic rename matching", () => {
  const before = completeSnapshot([
    {
      kind: "opaque-object",
      id: "event-old",
      objectKind: "event",
      physicalName: "event-old",
      data: { sql: "CREATE EVENT event-old" },
    },
  ])
  const after = completeSnapshot([
    {
      kind: "opaque-object",
      id: "event-new",
      objectKind: "event",
      physicalName: "event-new",
      data: { sql: "CREATE EVENT event-new" },
    },
  ])

  const result = diffSnapshots(before, after)

  expect(result.renames).toEqual([])
  expect(result.diagnostics.some((issue) => issue.code === "lossy")).toBe(true)
  expect(result.operations.some((operation) => operation.type === "remove")).toBe(true)
  expect(result.operations.some((operation) => operation.type === "add")).toBe(true)
})

test("compares complete v2 object groups independently of array order", () => {
  const before = completeSnapshot(
    [],
    [
      {
        kind: "deferred-object",
        id: "sequence-a",
        objectKind: "sequence",
        physicalName: "sequence_a",
        reason: "adapter boundary",
      },
      {
        kind: "deferred-object",
        id: "sequence-b",
        objectKind: "sequence",
        physicalName: "sequence_b",
        reason: "adapter boundary",
      },
    ],
  )
  const after = completeSnapshot([], [...before.deferredObjects].reverse())

  const result = diffSnapshots(before, after)

  expect(result.equal).toBe(true)
  expect(result.operations).toEqual([])
  expect(result.diagnostics.some((issue) => issue.code === "unknown")).toBe(true)
  expect(result.diagnostics.some((issue) => issue.code === "unsupported")).toBe(true)
})

test("decodes invalid snapshots as structured diff diagnostics", () => {
  const result = decodeSnapshotForDiff({ version: 99 })

  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.diagnostics[0]?.code).toBe("invalid-snapshot")
  }
})
