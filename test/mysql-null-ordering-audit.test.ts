import { expect, test } from "vitest"

import { mysqlDialect } from "../src/dialects/mysql.ts"
import { postgresDialect } from "../src/dialects/postgres.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import {
  asc,
  desc,
  fetchFirst,
  from,
  integer,
  offset,
  orderBy,
  QueryValidationError,
  render,
  select,
  table,
} from "../src/index.ts"

const records = table("records", {
  id: integer(),
  rank: integer({ nullable: true }),
})
const cases = [
  {
    label: "ascending nulls last",
    term: asc(records.rank, "LAST"),
    native: "ASC NULLS LAST",
  },
  {
    label: "descending nulls first",
    term: desc(records.rank, "FIRST"),
    native: "DESC NULLS FIRST",
  },
] as const

test.each(cases)(
  "keeps unsupported null-order syntax out of MySQL pagination ($label)",
  ({ term }) => {
    const query = select(
      { id: records.id },
      from(records),
      orderBy(term, records.id),
      offset(1),
      fetchFirst(2),
    )
    let statement: ReturnType<typeof render>

    try {
      statement = render(query, mysqlDialect())
    } catch (error) {
      // A deliberate unsupported-feature diagnostic is safe if no equivalent
      // MySQL ordering is implemented. Sending invalid SQL is not.
      expect(error).toBeInstanceOf(QueryValidationError)
      expect(error).toMatchObject({ code: "missing-dialect-capability" })
      return
    }

    // MySQL's ORDER BY grammar allows ASC/DESC but has no NULLS FIRST/LAST.
    // https://dev.mysql.com/doc/refman/8.4/en/select.html
    expect(statement.text).not.toMatch(/\bNULLS\s+(?:FIRST|LAST)\b/i)
  },
)

test.each(cases)(
  "retains native explicit null ordering on PostgreSQL and SQLite ($label)",
  ({ term, native }) => {
    const query = select(
      { id: records.id },
      from(records),
      orderBy(term, records.id),
      fetchFirst(2),
    )

    for (const dialect of [postgresDialect(), sqliteDialect()]) {
      expect(render(query, dialect).text).toContain(`"records"."rank" ${native}`)
    }
  },
)

test("keeps ordinary MySQL pagination renderable", () => {
  const query = select(
    { id: records.id },
    from(records),
    orderBy(asc(records.rank), records.id),
    offset(1),
    fetchFirst(2),
  )

  expect(render(query, mysqlDialect())).toEqual({
    text: "SELECT `records`.`id` AS `id` FROM `records` ORDER BY `records`.`rank` ASC, `records`.`id` LIMIT 2 OFFSET 1",
    parameters: [],
  })
})
