import { expect, test } from "vitest"

import { customClause, typedValue } from "../src/core/index.ts"
import type { SqlUuid } from "../src/core/sql-types.ts"
import { date, eq, from, integer, select, table, text, render, where } from "../src/index.ts"

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

test("carries the DATE domain when binding an application Date in a column predicate", () => {
  const events = table("events", { occurredOn: date() })
  const day = new Date("2026-10-22T00:00:00.000Z")
  const query = select(
    { occurredOn: events.occurredOn },
    from(events),
    where(eq(events.occurredOn, day)),
  )

  // The default node:sqlite encoder rejects an untyped Date, even when the same
  // application value was successfully encoded by an INSERT into this column.
  expect(render(query)).toMatchObject({
    parameters: [day],
    parameterSqlTypes: ["date"],
  })
})
