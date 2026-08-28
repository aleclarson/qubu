import { DatabaseSync } from "node:sqlite"

import { expect, expectTypeOf, test } from "vitest"

import { createDialect } from "../src/core/index.ts"
import type { Dialect } from "../src/core/index.ts"
import { mysqlDialect } from "../src/dialects/mysql.ts"
import { postgresDialect } from "../src/dialects/postgres.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import {
  from,
  json,
  jsonBoolean,
  jsonExists,
  jsonNumber,
  jsonPath,
  jsonText,
  render,
  select,
  table,
} from "../src/index.ts"

const events = table("events", {
  payload: json<{
    user: {
      name: string
      active: boolean
    }
    scores: number[]
  }>(),
})

const query = select(
  {
    name: jsonText(events.payload, jsonPath("user", "name")),
    score: jsonNumber(events.payload, jsonPath("scores", 0)),
    active: jsonBoolean(events.payload, jsonPath("user", "active")),
    hasEmail: jsonExists(events.payload, jsonPath("user", "email")),
  },
  from(events),
)

test("renders standard SQL scalar extraction and existence semantics", () => {
  expect(render(query)).toEqual({
    text:
      'SELECT JSON_VALUE("events"."payload", \'$."user"."name" ? (@.type() == "string")\' RETURNING VARCHAR(512) NULL ON EMPTY NULL ON ERROR) AS "name", ' +
      'JSON_VALUE("events"."payload", \'$."scores"[0] ? (@.type() == "number")\' RETURNING DOUBLE PRECISION NULL ON EMPTY NULL ON ERROR) AS "score", ' +
      'JSON_VALUE("events"."payload", \'$."user"."active" ? (@.type() == "boolean")\' RETURNING BOOLEAN NULL ON EMPTY NULL ON ERROR) AS "active", ' +
      'COALESCE(JSON_EXISTS("events"."payload", \'$."user"."email"\' FALSE ON ERROR), FALSE) AS "hasEmail" FROM "events"',
    parameters: [],
  })

  expectTypeOf(query.row.name).toEqualTypeOf<string | null>()
  expectTypeOf(query.row.score).toEqualTypeOf<number | null>()
  expectTypeOf(query.row.active).toEqualTypeOf<boolean | null>()
  expectTypeOf(query.row.hasEmail).toEqualTypeOf<boolean>()
})

test("renders PostgreSQL JSON paths with type guards", () => {
  const rendered = render(query, postgresDialect())

  expect(rendered.text).toContain(
    `jsonb_typeof(jsonb_path_query_first(CAST("events"."payload" AS JSONB), '$."user"."name"')) WHEN 'string'`,
  )
  expect(rendered.text).toContain(
    `jsonb_path_exists(CAST("events"."payload" AS JSONB), '$."user"."email"', '{}'::JSONB, TRUE)`,
  )
  expect(rendered.parameters).toEqual([])
})

test("renders MySQL JSON paths with type guards", () => {
  const rendered = render(query, mysqlDialect())

  expect(rendered.text).toContain(
    `CASE JSON_TYPE(JSON_EXTRACT(\`events\`.\`payload\`, '$."user"."name"')) WHEN 'STRING'`,
  )
  expect(rendered.text).toContain(
    `JSON_CONTAINS_PATH(\`events\`.\`payload\`, 'one', '$."user"."email"')`,
  )
  expect(rendered.parameters).toEqual([])
})

test("renders SQLite JSON paths with scalar type guards", () => {
  const rendered = render(query, sqliteDialect())

  expect(rendered.text).toContain(
    `CASE json_type("events"."payload", '$."scores"[0]') WHEN 'integer'`,
  )
  expect(rendered.text).toContain(`(json_type("events"."payload", '$."user"."email"') IS NOT NULL)`)
  expect(rendered.parameters).toEqual([])
})

test("preserves JSON null, missing, type, and existence semantics in SQLite", () => {
  const database = new DatabaseSync(":memory:")

  try {
    database.exec("CREATE TABLE events (payload TEXT)")
    const insert = database.prepare("INSERT INTO events VALUES (?)")

    insert.run(
      JSON.stringify({
        user: {
          name: "Ada",
          active: true,
          email: null,
        },
        scores: [9.5],
      }),
    )
    insert.run(
      JSON.stringify({
        user: {
          name: 42,
          active: "yes",
        },
        scores: ["high"],
      }),
    )
    insert.run(JSON.stringify({ user: null }))

    const rendered = render(query, sqliteDialect())

    expect(database.prepare(rendered.text).all()).toEqual([
      {
        name: "Ada",
        score: 9.5,
        active: 1,
        hasEmail: 1,
      },
      {
        name: null,
        score: null,
        active: null,
        hasEmail: 0,
      },
      {
        name: null,
        score: null,
        active: null,
        hasEmail: 0,
      },
    ])
  } finally {
    database.close()
  }
})

test("escapes path keys as JSON and SQL literals", () => {
  const escaped = select(
    {
      value: jsonText(events.payload, jsonPath(`owner's`, "a.b", 'say"hi')),
    },
    from(events),
  )

  expect(render(escaped).text).toContain(`'$."owner''s"."a.b"."say\\"hi" ? (@.type() == "string")'`)
})

test("rejects invalid array indexes", () => {
  expect(() => jsonPath(-1)).toThrow("JSON path indexes must be non-negative safe integers")
  expect(() => jsonPath(1.5)).toThrow("JSON path indexes must be non-negative safe integers")
})

test("diagnoses a missing JSON renderer at runtime when types are bypassed", () => {
  const dialect = {
    ...createDialect({
      name: "claims-json",
      placeholder: () => "?",
    }),
    capabilities: ["json"] as const,
  }

  expect(() => render(query, dialect as unknown as Dialect)).toThrow(
    'Dialect "claims-json" advertises JSON support without a JSON renderer',
  )
})
