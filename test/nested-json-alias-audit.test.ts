import { expect, test } from "vitest"

import { mysqlDialect } from "../src/dialects/mysql.ts"
import { postgresDialect } from "../src/dialects/postgres.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import { cast, jsonArrayFrom, jsonObjectFrom, render, select, text, value } from "../src/index.ts"

const dialects = [postgresDialect(), sqliteDialect(), mysqlDialect()]
const nesting = [
  {
    kind: "array",
    nest: jsonArrayFrom,
  },
  {
    kind: "object",
    nest: jsonObjectFrom,
  },
] as const

test.each(
  dialects.flatMap((dialect) =>
    nesting.map((entry) => ({
      dialect,
      ...entry,
    })),
  ),
)("rejects ambiguous relational aliases in a $dialect.name JSON $kind", ({ dialect, nest }) => {
  const ambiguous = select({
    displayName: cast(value("camel"), text()),
    display_name: cast(value("snake"), text()),
  })

  // A result projection preserves these distinct names. Nesting introduces a
  // relation where both become display_name and must be rejected before execution.
  expect(() => render(ambiguous, dialect)).not.toThrow()
  expect(() => render(select({ nested: nest(ambiguous) }), dialect)).toThrowError(
    'Fields "displayName" and "display_name" both resolve to SQL name "display_name"',
  )
})

test.each(dialects)("keeps distinct relational aliases renderable in $name JSON", (dialect) => {
  const unambiguous = select({
    displayName: cast(value("camel"), text()),
    storageName: cast(value("snake"), text()),
  })

  expect(() =>
    render(
      select({
        rows: jsonArrayFrom(unambiguous),
        row: jsonObjectFrom(unambiguous),
      }),
      dialect,
    ),
  ).not.toThrow()
})
