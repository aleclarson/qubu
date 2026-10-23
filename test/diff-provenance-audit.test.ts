import { expect, test } from "vitest"

import { diffSnapshots } from "../src/diff/index.ts"
import type { SchemaSnapshot } from "../src/snapshot/index.ts"

function snapshot(provenance: unknown): SchemaSnapshot {
  const table: Record<string, unknown> = {
    kind: "table",
    id: "accounts",
    physicalName: "accounts",
    columns: [],
    constraints: [],
    indexes: [],
  }

  if (provenance !== undefined) {
    table.provenance = provenance
  }

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
    namespace: {
      kind: "sqlite-database",
      name: "main",
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
    tables: [table as SchemaSnapshot["tables"][number]],
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

test("ignores provenance churn between otherwise identical objects", () => {
  const diff = diffSnapshots(
    snapshot({
      kind: "catalog",
      dialect: "sqlite",
      path: ["runs", 1],
    }),
    snapshot({
      kind: "catalog",
      dialect: "sqlite",
      path: ["runs", 2],
    }),
  )

  expect(diff.operations).toEqual([])
})

test("does not mark provenance removal as destructive", () => {
  const diff = diffSnapshots(
    snapshot({
      kind: "catalog",
      dialect: "sqlite",
      path: ["runs", 1],
    }),
    snapshot(undefined),
  )

  expect(diff.operations).toEqual([])
  expect(diff.diagnostics.filter((item) => item.code === "destructive")).toEqual([])
})
