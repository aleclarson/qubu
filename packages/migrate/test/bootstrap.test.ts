import type { CompleteSchemaSnapshot, SchemaSnapshot } from "qubu/snapshot"
import { expect, test } from "vitest"

import { compareManagedSnapshots } from "../src/baseline/index.ts"
import { prepareSchemaBootstrap } from "../src/bootstrap/index.ts"
import * as postgresBootstrap from "../src/bootstrap/postgres.ts"

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

test("bootstraps a complete PostgreSQL snapshot with enums before dependent tables", () => {
  const target = postgresSnapshot()
  const result = postgresBootstrap.planSchemaBootstrap(target)

  expect(result.ok).toBe(true)
  if (!result.ok) return

  expect(result.beforeSnapshot).toMatchObject({
    format: "qubu-schema",
    version: 2,
    dialect: target.dialect,
    namespace: target.namespace,
    tables: [],
    enums: [],
  })
  expect(result.plan.dependencies).toEqual(
    expect.arrayContaining([expect.objectContaining({ reason: "reference-before-dependent" })]),
  )
  expect(
    result.program.phases.flatMap((phase) => phase.statements.map((item) => item.sql)),
  ).toEqual([
    `CREATE TYPE "public"."account_role" AS ENUM ('member', 'owner')`,
    `CREATE TABLE "public"."accounts" ("role" account_role NOT NULL)`,
  ])
})

test("keeps unsupported bootstrap dialects explicit", () => {
  const target: SchemaSnapshot = {
    format: "qubu-schema",
    version: 2,
    dialect: { name: "mysql", version: 1 },
    namingPolicy: { name: "test", version: 1 },
    namespace: { kind: "mysql-database", name: "app" },
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
    deferredObjects: [],
    opaqueObjects: [],
    comments: [],
    ownership: [],
  }

  expect(postgresBootstrap.planSchemaBootstrap(target)).toEqual({
    ok: false,
    diagnostics: [
      { code: "unsupported", message: "Bootstrap currently supports SQLite and PostgreSQL" },
    ],
  })
})

test("retains exact policy requirements for incomplete PostgreSQL objects", () => {
  const target: CompleteSchemaSnapshot = {
    ...postgresSnapshot(),
    opaqueObjects: [
      {
        kind: "opaque-object",
        id: "foreign-object",
        objectKind: "postgres-relation:f",
        physicalName: "foreign_accounts",
        data: {},
      },
    ],
  }
  const prepared = prepareSchemaBootstrap(target)

  expect(prepared.ok).toBe(true)
  if (!prepared.ok) return
  const operation = prepared.plan.operations.find((item) => item.kind === "opaque-object")

  expect(operation).toMatchObject({ safety: "unknown", status: "approved" })
  expect(postgresBootstrap.planSchemaBootstrap(target)).toMatchObject({
    ok: false,
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "approval-required", operationId: operation?.id }),
      expect.objectContaining({
        code: "custom-program-required",
        operationId: operation?.id,
      }),
    ]),
  })
})

test("uses the same complete PostgreSQL snapshot for baseline comparison", () => {
  const target = postgresSnapshot()
  const changed: CompleteSchemaSnapshot = {
    ...target,
    enums: target.enums.map((item) => ({
      ...item,
      values: [...item.values, { value: "admin", ordinalPosition: 3 }],
    })),
  }

  expect(compareManagedSnapshots(target, target).matches).toBe(true)
  expect(compareManagedSnapshots(target, changed).matches).toBe(false)
})
