import { expect, test } from "vitest"

import { diffSnapshots } from "../src/diff/index.ts"
import { integer, primaryKey, schema, table } from "../src/index.ts"
import {
  createSchemaSnapshot,
  type SchemaSnapshot,
  type SnapshotConstraint,
} from "../src/snapshot/index.ts"

function snapshot(): SchemaSnapshot {
  const parents = table("parents", { id: integer() }, (columns) => ({
    constraints: { primary: primaryKey(columns.id) },
    indexes: {},
  }))
  const accounts = table("accounts", {
    first: integer(),
    second: integer(),
  })

  return createSchemaSnapshot(
    schema({
      accounts,
      parents,
    }),
  )
}

function keySnapshot(
  kind: "primary-key" | "unique" | "foreign-key",
  member: string,
): SchemaSnapshot {
  const before = snapshot()
  const common = {
    id: "accountKey",
    physicalName: "account_key",
    columns: [member],
  }
  const constraint: SnapshotConstraint =
    kind === "foreign-key"
      ? {
          ...common,
          kind,
          target: {
            table: {
              kind: "table",
              id: "parents",
            },
            columns: ["id"],
          },
        }
      : {
          ...common,
          kind,
        }

  return {
    ...before,
    tables: before.tables.map((entry) =>
      entry.id === "accounts"
        ? {
            ...entry,
            constraints: [constraint],
          }
        : entry,
    ),
  }
}

test.each(["primary-key", "unique", "foreign-key"] as const)(
  "detects changed local column membership of a %s constraint",
  (kind) => {
    const result = diffSnapshots(keySnapshot(kind, "first"), keySnapshot(kind, "second"))

    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === "invalid-snapshot"),
    ).toEqual([])
    expect(result.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "property-change",
          kind: "constraint",
          logicalId: "accountKey",
          changedProperties: expect.arrayContaining([
            expect.objectContaining({
              path: ["columns", 0],
              before: "first",
              after: "second",
            }),
          ]),
        }),
      ]),
    )
  },
)

test("classifies nested VARCHAR length narrowing as potentially destructive", () => {
  const initial = snapshot()
  const before: SchemaSnapshot = {
    ...initial,
    dialect: {
      name: "postgresql",
      version: 1,
    },
    namespace: {
      kind: "postgres-schema",
      name: "public",
    },
    tables: initial.tables.map((entry) => ({
      ...entry,
      columns: entry.columns.map((column) =>
        entry.id === "accounts" && column.id === "first"
          ? {
              ...column,
              storage: {
                kind: "native",
                dialect: "postgresql",
                type: "VARCHAR(80)",
              },
            }
          : column,
      ),
    })),
  }
  const after: SchemaSnapshot = {
    ...before,
    tables: before.tables.map((entry) =>
      entry.id === "accounts"
        ? {
            ...entry,
            columns: entry.columns.map((column) =>
              column.id === "first"
                ? {
                    ...column,
                    storage: {
                      kind: "native",
                      dialect: "postgresql",
                      type: "VARCHAR(8)",
                    },
                  }
                : column,
            ),
          }
        : entry,
    ),
  }

  const result = diffSnapshots(before, after)

  expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "invalid-snapshot")).toEqual(
    [],
  )
  expect(result.operations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "property-change",
        kind: "column",
        logicalId: "first",
        destructive: true,
      }),
    ]),
  )
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "destructive",
        kind: "column",
        logicalId: "first",
      }),
    ]),
  )
})

test("ignores column collection ordering while preserving constraint membership", () => {
  const before = keySnapshot("unique", "first")
  const after = {
    ...before,
    tables: before.tables.map((entry) => ({
      ...entry,
      columns: [...entry.columns].reverse(),
    })),
  }

  expect(diffSnapshots(before, after).operations).toEqual([])
})
