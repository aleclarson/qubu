import { expect, test } from "vitest"

import { createDialect } from "../src/core/index.ts"
import { mysqlDialect } from "../src/dialects/mysql.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import { cast, column, from, numeric, render, select, table, text, uuid } from "../src/index.ts"
import type { SqlSemanticType, SqlTextLike } from "../src/index.ts"

const records = table("records", { id: uuid() })

test("renders definition cast targets through the active dialect", () => {
  const query = select(
    {
      idAsText: cast(records.id, text()),
      idAsNumber: cast(records.id, numeric()),
    },
    from(records),
  )

  expect(render(query).text).toBe(
    'SELECT CAST("records"."id" AS TEXT) AS "idAsText", CAST("records"."id" AS DECIMAL) AS "idAsNumber" FROM "records"',
  )
  expect(render(query, mysqlDialect()).text).toBe(
    "SELECT CAST(`records`.`id` AS CHAR) AS `idAsText`, CAST(`records`.`id` AS DECIMAL) AS `idAsNumber` FROM `records`",
  )
  expect(render(query, sqliteDialect()).text).toBe(
    'SELECT CAST("records"."id" AS TEXT) AS "idAsText", CAST("records"."id" AS NUMERIC) AS "idAsNumber" FROM "records"',
  )

  const customDialect = createDialect({
    name: "custom",
    placeholder: () => "?",
    castTypes: { text: "STRING" },
  })

  expect(render(query, customDialect).text).toContain('CAST("records"."id" AS STRING)')
})

test("renders a custom definition cast target verbatim", () => {
  interface SqlCitext extends SqlSemanticType<"postgres.citext">, SqlTextLike {}

  const citext = column<string, string, string, SqlCitext>({
    castType: "CITEXT",
  })
  const query = select({ id: cast(records.id, citext) }, from(records))

  expect(render(query).text).toBe('SELECT CAST("records"."id" AS CITEXT) AS "id" FROM "records"')
})
