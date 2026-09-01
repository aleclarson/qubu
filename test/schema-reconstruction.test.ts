import { expect, test } from "vitest"

import {
  catalogCheck,
  catalogForeignKey,
  column,
  primaryKey,
  references,
  schema,
  table,
} from "../src/index.ts"
import { createSchemaSnapshot } from "../src/snapshot/index.ts"
import { postgresSchemaDialect } from "../src/snapshot/postgres.ts"

test("serializes catalog reconstruction as ordinary schema metadata", () => {
  const parent = table(
    "catalog_parent",
    {
      id: column<number>(),
      alternateId: column<number>(),
    },
    (parent) => ({
      constraints: { parentPrimary: primaryKey(parent.id) },
      indexes: {},
    }),
  )
  const child = table("catalog_child", { parentId: column<number>() }, (child) => ({
    constraints: {
      childParent: catalogForeignKey([child.parentId], () => references(parent, parent.id), {
        physicalName: "catalog_child_parent_fk",
        onDelete: "cascade",
      }),
      positiveParent: catalogCheck(
        {
          dialect: "postgresql",
          sql: "parent_id > 0\r\nAND parent_id < 100",
        },
        { physicalName: "catalog_child_parent_check" },
      ),
    },
    indexes: {},
  }))

  const snapshot = createSchemaSnapshot(
    schema({
      child,
      parent,
    }),
    {
      dialect: postgresSchemaDialect,
    },
  )
  const childSnapshot = snapshot.tables.find((table) => table.id === "child")

  expect(childSnapshot?.constraints).toEqual([
    {
      id: "childParent",
      kind: "foreign-key",
      physicalName: "catalog_child_parent_fk",
      columns: ["parentId"],
      target: {
        table: {
          kind: "table",
          id: "parent",
        },
        columns: ["id"],
      },
      onDelete: "cascade",
    },
    {
      id: "positiveParent",
      kind: "check",
      physicalName: "catalog_child_parent_check",
      expression: {
        kind: "expression",
        expressionKind: "unsafe",
        sql: "parent_id > 0\nAND parent_id < 100",
        dialect: "postgresql",
      },
    },
  ])
})

test("rejects invalid catalog evidence at runtime", () => {
  expect(() =>
    Reflect.apply(catalogCheck, undefined, [
      {
        dialect: "oracle",
        sql: "value > 0",
      },
    ]),
  ).toThrowError(/supported catalog dialect/)
  expect(() =>
    Reflect.apply(catalogCheck, undefined, [
      {
        dialect: "sqlite",
        sql: "   ",
      },
    ]),
  ).toThrowError(/non-empty SQL/)

  const target = table("catalog_runtime_target", {
    id: column<number>(),
    alternateId: column<number>(),
  })
  const local = table("catalog_runtime_local", { targetId: column<number>() })

  expect(() =>
    Reflect.apply(catalogForeignKey, undefined, [
      [local.targetId],
      references(target, target.id, target.alternateId),
    ]),
  ).toThrowError(/column arity differs/)
  expect(() =>
    Reflect.apply(catalogForeignKey, undefined, [
      [local.targetId],
      references(target, local.targetId),
    ]),
  ).toThrowError(/does not belong to its table/)
})
