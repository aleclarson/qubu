import { expect, test } from "vitest"

import { postgresDialect } from "../src/dialects/postgres.ts"
import { from, insertInto, jsonArrayFrom, render, select, values } from "../src/index.ts"
import { accountEntries, parentRecords } from "./codegen-rich.generated.ts"

// The codegen suite checks these compiled fixtures against freshly generated
// source. Exercise their query-facing metadata as well as their snapshot facts.
test("retains inferred SQL domains in generated schema result shapes", () => {
  const query = select({ id: parentRecords.id }, from(parentRecords))

  expect(query.resultShape).toEqual({
    fields: [
      {
        name: "id",
        sqlType: "integer",
      },
    ],
  })
})

test("retains inferred SQL domains when binding generated schema insert columns", () => {
  const query = insertInto(
    accountEntries,
    values({
      id: 7,
      status: "active",
    }),
  )

  expect(render(query)).toMatchObject({
    parameters: [7, "active"],
    parameterSqlTypes: ["integer", "text"],
  })
})

test("renders nested JSON over a generated column with an inferred supported SQL domain", () => {
  const rows = select({ id: parentRecords.id }, from(parentRecords))
  const query = select({ parents: jsonArrayFrom(rows) })

  expect(render(query, postgresDialect()).text).toContain("json_build_object(")
})
