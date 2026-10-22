import { from, render, select, subtract, table, value } from "qubu"
import { expect, test } from "vitest"

import { pgvector } from "../src/index.ts"

test("groups cosine distance when converting it to a similarity score", () => {
  const items = table("items", { embedding: pgvector.vector(3) })
  const similarity = subtract(value(1), pgvector.cosineDistance(items.embedding, [1, 2, 3]))

  expect(render(select({ similarity }, from(items)), pgvector.dialect())).toEqual({
    text: 'SELECT ($1 - ("items"."embedding" <=> $2)) AS "similarity" FROM "items"',
    parameters: [1, "[1,2,3]"],
    parameterSqlTypes: [undefined, "postgres.vector"],
  })
})
