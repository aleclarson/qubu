import { integer, table, text } from "qubu"
import { expect, test } from "vitest"
import { z } from "zod"

import { $type, defineCollection, serverOnly } from "../src/index.ts"

const todos = table("todos", {
  ownerId: integer(),
  id: text(),
  title: text(),
})

test("excludes server-only Qubu fields from Valtio Sync records", () => {
  const definition = defineCollection({
    dbType: $type<typeof todos>(),
    fields: {
      ownerId: serverOnly(),
      id: z.string(),
      title: z.string().default(""),
    },
  })

  expect(definition.recordSchema.parse({ id: "todo-1" })).toEqual({
    id: "todo-1",
    title: "",
  })
  expect(
    definition.recordSchema.safeParse({
      ownerId: 7,
      id: "todo-1",
    }).success,
  ).toBe(false)
})
