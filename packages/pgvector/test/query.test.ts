import {
  asc,
  fetchFirst,
  from,
  integer,
  orderBy,
  render,
  schema,
  select,
  table,
} from "qubu"
import { createSchemaSnapshot } from "qubu/snapshot/postgres"
import { describe, expect, test } from "vitest"

import { pgvector } from "../src/index.ts"

describe("pgvector namespace", () => {
  test("renders an index-friendly cosine nearest-neighbor query", () => {
    const items = table("items", {
      id: integer(),
      embedding: pgvector.vector(3),
    })
    const distance = pgvector.cosineDistance(items.embedding, [1, 2, 3])
    const query = select(
      {
        id: items.id,
        distance,
      },
      from(items),
      orderBy(asc(distance)),
      fetchFirst(5),
    )

    expect(render(query, pgvector.dialect())).toEqual({
      text: 'SELECT "items"."id" AS "id", "items"."embedding" <=> $1 AS "distance" FROM "items" ORDER BY "items"."embedding" <=> $2 ASC LIMIT $3',
      parameters: ["[1,2,3]", "[1,2,3]", 5],
      parameterSqlTypes: ["postgres.vector", "postgres.vector", "integer"],
    })
  })

  test("rejects a dialect without the pgvector capability", () => {
    const items = table("items", { embedding: pgvector.vector(3) })
    const query = select(
      { distance: pgvector.l2Distance(items.embedding, [1, 2, 3]) },
      from(items),
    )

    expect(() => render(query, { dialect: undefined })).toThrow(
      'Dialect "standard-sql" does not support the "postgres-pgvector" capability',
    )
  })
})

test("encodes and decodes dense vectors", () => {
  expect(pgvector.toSql([1, 2, 3], 3)).toBe("[1,2,3]")
  expect(pgvector.fromSql("[1, 2, 3]", 3)).toEqual([1, 2, 3])
  expect(() => pgvector.toSql([1, 2], 3)).toThrow("expected 3")
  expect(() => pgvector.fromSql("[1, Infinity]", 2)).toThrow("finite numbers")
})

test("declares the matching pgvector index operator class", () => {
  const items = table(
    "items",
    { embedding: pgvector.vector(3) },
    (table) => ({
      constraints: {},
      indexes: {
        embeddingCosine: pgvector.index(table.embedding, { distance: "cosine" }),
      },
    }),
  )

  expect(items.indexes.embeddingCosine.dialect).toMatchObject({
    dialect: "postgresql",
    method: "hnsw",
  })
  expect(items.indexes.embeddingCosine.termOptions).toEqual([
    { operatorClass: "vector_cosine_ops" },
  ])

  const snapshot = createSchemaSnapshot(schema({ items }))

  expect(snapshot.tables[0]?.indexes[0]).toMatchObject({
    dialect: {
      data: {
        method: "hnsw",
      },
    },
    terms: [{ operatorClass: "vector_cosine_ops" }],
  })
})
