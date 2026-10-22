import { integer, primaryKey, schema, table, text } from "qubu"
import { diffSnapshots } from "qubu/diff"
import { createSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { expect, test } from "vitest"

import { emitMigrationPlan } from "../src/ddl/postgres.ts"
import { createMigrationPlan } from "../src/plan/index.ts"

test("removes a referencing foreign key before its target table", () => {
  const parent = table("parent", { id: integer() }, (columns) => ({
    constraints: { pk: primaryKey(columns.id) },
    indexes: {},
  }))
  const child = table("child", { parentId: integer() })
  const base = createSchemaSnapshot(
    schema({
      parent,
      child,
    }),
  )
  const before: SchemaSnapshot = {
    ...base,
    dialect: {
      name: "postgresql",
      version: 1,
    },
    namespace: {
      kind: "postgres-schema",
      name: "public",
    },
    tables: base.tables.map((entry) =>
      entry.id === "child"
        ? {
            ...entry,
            constraints: [
              {
                kind: "foreign-key",
                id: "fk2",
                physicalName: "child_parent_fk2",
                columns: ["parentId"],
                target: {
                  table: {
                    kind: "table",
                    id: "parent",
                  },
                  columns: ["id"],
                },
              },
            ],
          }
        : entry,
    ),
  }
  const after: SchemaSnapshot = {
    ...before,
    tables: before.tables
      .filter((entry) => entry.id !== "parent")
      .map((entry) => ({
        ...entry,
        constraints: [],
      })),
  }
  const planned = createMigrationPlan(diffSnapshots(before, after), { allowDestructive: true })

  expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
  const foreignKey = planned.plan.operations.find((operation) => operation.logicalId === "fk2")
  const target = planned.plan.operations.find(
    (operation) => operation.kind === "table" && operation.logicalId === "parent",
  )

  expect(foreignKey).toBeDefined()
  expect(target).toBeDefined()
  expect(foreignKey!.position).toBeLessThan(target!.position)
})

test.each([false, true])(
  "changes nullability without changing an existing generated expression (generated: %s)",
  (generated) => {
    const records = table("records", {
      label: text(),
      size: integer({ nullable: true }),
    })
    const base = createSchemaSnapshot(schema({ records }))
    const before: SchemaSnapshot = {
      ...base,
      dialect: {
        name: "postgresql",
        version: 1,
      },
      namespace: {
        kind: "postgres-schema",
        name: "public",
      },
      tables: base.tables.map((entry) => ({
        ...entry,
        columns: entry.columns.map((column) =>
          generated && column.id === "size"
            ? {
                ...column,
                generated: true,
                generatedColumn: {
                  kind: "expression",
                  mode: "stored",
                  expression: {
                    kind: "expression",
                    expressionKind: "unsafe",
                    sql: 'length("label")',
                    dialect: "postgresql",
                  },
                },
              }
            : column,
        ),
      })),
    }
    const after: SchemaSnapshot = {
      ...before,
      tables: before.tables.map((entry) => ({
        ...entry,
        columns: entry.columns.map((column) =>
          column.id === "size"
            ? {
                ...column,
                nullable: false,
              }
            : column,
        ),
      })),
    }
    const planned = createMigrationPlan(diffSnapshots(before, after), { allowDestructive: true })

    expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
    const emitted = emitMigrationPlan(planned.plan, { allowDestructive: true })

    expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true)
    expect(emitted.sql).toContain('ALTER COLUMN "size" SET NOT NULL')
  },
)
