import { expect, test } from "vitest"

import { customClause, typedValue } from "../src/core/index.ts"
import type { SqlUuid } from "../src/core/sql-types.ts"
import { eq, from, integer, select, table, text, render, where } from "../src/index.ts"

const users = table("users", {
  id: integer(),
  name: text(),
})

test("keeps runtime parameter order after metadata removal", () => {
  const date = new Date("2026-01-01T00:00:00.000Z")
  const query = select(
    { id: users.id },
    from(users),
    where(eq(users.id, 42)),
    customClause({
      name: "as-of",
      order: 80,
      render(context) {
        context.append("AS OF ")
        context.parameter(date, "date")
      },
    }),
  )

  expect(render(query)).toEqual({
    text: 'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = ?) AS OF ?',
    parameters: [42, date],
    parameterSqlTypes: [undefined, "date"],
  })
})

test("carries explicit typed-value domains beside raw parameters", () => {
  const uuidValue = typedValue<SqlUuid, string>("uuid", "uuid")

  expect(render(uuidValue)).toMatchObject({
    parameters: ["uuid"],
    parameterSqlTypes: ["uuid"],
  })
})
