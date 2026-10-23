import { canonicalJson } from "qubu/snapshot"
import type { SchemaSnapshot } from "qubu/snapshot"
import { expect, test } from "vitest"

import { evaluateMigrationPrecondition } from "../src/plan/index.ts"

const dialect = {
  name: "sqlite",
  version: 1,
} as const

test("renders equal objects canonically regardless of key insertion order", () => {
  const left = {
    kind: "native",
    dialect: "sqlite",
    type: "TEXT",
  }
  const right = {
    type: "TEXT",
    dialect: "sqlite",
    kind: "native",
  }

  expect(canonicalJson(left)).toBe(canonicalJson(right))
})

test("matches property preconditions when a live snapshot reorders object keys", () => {
  const stored = {
    kind: "native",
    dialect: "sqlite",
    type: "TEXT",
  } as const
  const live = {
    type: "TEXT",
    kind: "native",
    dialect: "sqlite",
  } as const
  const snapshot: SchemaSnapshot = {
    format: "qubu-schema",
    version: 1,
    dialect,
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
    tables: [
      {
        kind: "table",
        id: "accounts",
        physicalName: "accounts",
        columns: [
          {
            kind: "column",
            id: "name",
            physicalName: "name",
            ordinalPosition: 1,
            nullable: true,
            hasDefault: false,
            generated: false,
            storage: live,
          },
        ],
        constraints: [],
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

  expect(
    evaluateMigrationPrecondition(snapshot, {
      type: "property-equals",
      path: ["tables", 0, "columns", 0],
      kind: "column",
      logicalId: "name",
      physicalName: "name",
      property: ["storage"],
      value: stored,
    }),
  ).toBe(true)
})
