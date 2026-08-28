import { expect, test } from "vitest"

import { render, select, scalar, value } from "../src/index.ts"
import { exactQuery, limitedQuery, ordinaryQuery } from "./cardinality-fixtures.ts"

test("renders scalar subqueries with cardinality clauses in parameter order", () => {
  const query = select({
    result: scalar(limitedQuery),
    marker: value(9),
  })

  expect(render(query)).toEqual({
    text: 'SELECT (SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = ?) FETCH FIRST ? ROWS ONLY) AS "result", ? AS "marker"',
    parameters: [7, 1, 9],
  })
})

test("renders exact-one scalar subqueries without changing the query boundary", () => {
  const query = select({ result: scalar(exactQuery) })

  expect(render(query)).toEqual({
    text: 'SELECT (SELECT ? AS "value") AS "result"',
    parameters: [42],
  })
})

test("keeps ordinary scalar subqueries render-compatible", () => {
  const query = select({ result: scalar(ordinaryQuery) })

  expect(render(query).text).toBe('SELECT (SELECT "users"."id" AS "id" FROM "users") AS "result"')
})
