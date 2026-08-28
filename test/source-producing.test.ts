import { expect, expectTypeOf, test } from "vitest"

import { render } from "../src/index.ts"
import { entries, entriesQuery, joinedEntriesQuery } from "./source-producing-fixtures.ts"

test("renders a parameterized table-valued source in FROM", () => {
  expect(render(entriesQuery)).toEqual({
    text: 'SELECT "entry"."key" AS "key", "entry"."value" AS "value" FROM json_each(?) AS "entry" WHERE ("entry"."key" = ?)',
    parameters: ['{"a":1}', 7],
  })
})

test("preserves produced-source row shape and left-join nullability", () => {
  expect(render(joinedEntriesQuery).text).toBe(
    'SELECT "users"."id" AS "userId", "entry"."value" AS "value", COUNT("entry"."key") AS "total" FROM "users" LEFT JOIN json_each(?) AS "entry" ON ("users"."id" = "entry"."key") GROUP BY "users"."id", "entry"."value"',
  )
  expectTypeOf(joinedEntriesQuery.row).toEqualTypeOf<{
    userId: number
    value: string | null
    total: number
  }>()
  expect(render(joinedEntriesQuery).parameters).toEqual(['{"a":1}'])
  expect(entries.columns.value).toBeDefined()
})
