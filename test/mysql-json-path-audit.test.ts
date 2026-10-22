import { expect, test } from "vitest"

import { mysqlDialect } from "../src/dialects/mysql.ts"
import { from, json, jsonExists, jsonPath, jsonText, render, select, table } from "../src/index.ts"

const records = table("records", { payload: json<unknown>() })

test.each([
  {
    label: "ordinary key",
    key: "plain",
  },
  {
    label: "apostrophe",
    key: "owner's",
  },
  {
    label: "double quote",
    key: 'say"hi',
  },
  {
    label: "backslash",
    key: "back\\slash",
  },
  {
    label: "newline",
    key: "line\nbreak",
  },
])("preserves a JSON path through default MySQL SQL-string escaping ($label)", ({ key }) => {
  const path = jsonPath(key)
  const query = select(
    {
      value: jsonText(records.payload, path),
      exists: jsonExists(records.payload, path),
    },
    from(records),
  )
  const statement = render(query, mysqlDialect())
  const expectedPath = `$.${JSON.stringify(key)}`
  // MySQL consumes SQL-string backslashes before interpreting a JSON path.
  // Preserve the JSON escapes through that extra parsing layer.
  // https://dev.mysql.com/doc/refman/8.4/en/json.html
  const expectedLiteral = `'${expectedPath.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`
  const unescapedLiteral = `'${expectedPath.replaceAll("'", "''")}'`

  // The type guard, extraction, and existence check must all use the same path.
  expect(statement.text).toContain(expectedLiteral)
  if (expectedLiteral !== unescapedLiteral) {
    expect(statement.text).not.toContain(unescapedLiteral)
  }
})
