import { expect, test } from "vitest"

import { aggregateFunction } from "../src/core/index.ts"
import { from, render, select } from "../src/index.ts"
import { users } from "./grouping-fixtures.ts"

test("renders downstream aggregates with bound arguments in order", () => {
  const collect = aggregateFunction<string>("app.collect")
  const query = select({ names: collect(users.name, ",", 2) }, from(users))

  expect(render(query)).toEqual({
    text: 'SELECT app.collect("users"."name", ?, ?) AS "names" FROM "users"',
    parameters: [",", 2],
  })
  expect(collect(users.name).expressionCategory).toBe("aggregate")
})

test("renders a zero-argument aggregate", () => {
  const total = aggregateFunction<number>("custom_total")

  expect(render(total())).toEqual({
    text: "custom_total()",
    parameters: [],
  })
})

test("rejects invalid aggregate names at declaration", () => {
  expect(() => aggregateFunction("count(*)")).toThrow("Invalid SQL routine name")
})
