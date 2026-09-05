import { expect, test } from "vitest"

import { mysqlDialect } from "../src/dialects/mysql.ts"
import { postgresDialect } from "../src/dialects/postgres.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import {
  all,
  add,
  unionAll,
  bigint,
  binary,
  boolean,
  cte,
  date,
  numeric,
  distinct,
  mapResult,
  cast,
  upper,
  count,
  divide,
  caseWhen,
  over,
  rowNumber,
  desc,
  fetchFirst,
  from,
  integer,
  json,
  jsonArrayFrom,
  jsonObjectFrom,
  offset,
  orderBy,
  render,
  scalar,
  select,
  table,
  text,
  timestamp,
  value,
  where,
  eq,
} from "../src/index.ts"
import { decodeResultRow, ResultDecodingError } from "../src/result.ts"

const items = table("items", {
  id: integer(),
  displayName: text(),
})
const input = select(
  { displayName: items.displayName },
  from(items),
  where(eq(items.id, 7)),
  orderBy(desc(items.id)),
  offset(1),
  fetchFirst(2),
)

test.each([postgresDialect(), sqliteDialect(), mysqlDialect()])(
  "preserves bound filters, hidden ordering and pagination in $name JSON arrays",
  (dialect) => {
    const rendered = render(select({ items: jsonArrayFrom(input) }), dialect)

    expect(rendered.parameters).toEqual(
      dialect.name === "mysql" ? ["displayName", 7] : ["displayName", 7, 2, 1],
    )
    expect(rendered.text).toContain("DENSE_RANK() OVER (ORDER BY")
    expect(rendered.text).toContain("DESC)")
    expect(rendered.text).toContain("__qubu_json_order")
    expect(rendered.text).toContain("COALESCE((SELECT")
    if (dialect.name === "mysql") {
      expect(rendered.text).toContain(
        "OVER (ORDER BY `__qubu_json`.`__qubu_json_order` ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)",
      )
      expect(rendered.text).toContain("LIMIT 1), JSON_ARRAY())")
    } else {
      expect(rendered.text).toContain('ORDER BY "__qubu_json"."__qubu_json_order")')
    }
  },
)

test("preserves exact bigint and binary transport in every dialect", () => {
  const source = table("typed", {
    id: bigint(),
    bytes: binary(),
  })
  const query = select({ nested: jsonArrayFrom(select(all(source), from(source))) })

  expect(render(query, postgresDialect()).text).toContain('CAST("__qubu_json"."id" AS TEXT)')
  expect(render(query, postgresDialect()).text).toContain('encode("__qubu_json"."bytes", \'hex\')')
  expect(render(query, mysqlDialect()).text).toContain("CAST(`__qubu_json`.`id` AS CHAR)")
  expect(render(query, sqliteDialect()).text).toContain('hex("__qubu_json"."bytes")')
})

const typed = table("typed", {
  id: bigint(),
  active: boolean(),
  day: date(),
  instant: timestamp(),
  bytes: binary(),
  payload: json<{ name: string }>(),
  count: integer(),
  title: text(),
})
const typedQuery = select({ nested: jsonArrayFrom(select(all(typed), from(typed))) })
const raw = {
  id: "9007199254740993",
  active: 1,
  day: "2026-09-05",
  instant: "2026-09-05 12:30:00",
  bytes: "00ff",
  payload: { name: "Ada" },
  count: 4,
  title: "Hello",
}
const decoded = {
  ...raw,
  id: 9007199254740993n,
  active: true,
  day: new Date("2026-09-05Z"),
  instant: new Date("2026-09-05T12:30:00Z"),
  bytes: new Uint8Array([0, 255]),
}

test.each([false, true])(
  "decodes nested logical values from JSON strings or native objects (string=%s)",
  (asString) => {
    const nested = asString ? JSON.stringify([raw]) : [raw]

    expect(
      decodeResultRow({ nested }, typedQuery.resultShape, undefined, postgresDialect(), 0),
    ).toEqual({ nested: [decoded] })
  },
)

test("retains recursive decoders through CTE and scalar metadata", () => {
  const tree = select({
    root: jsonObjectFrom(select({ children: jsonArrayFrom(select(all(typed), from(typed))) })),
  })
  const source = cte("tree", tree)
  const projected = select({
    root: scalar(select({ root: source.root }, from(source), fetchFirst(1))),
  })

  expect(
    decodeResultRow(
      { root: JSON.stringify({ children: [raw] }) },
      projected.resultShape,
      undefined,
      sqliteDialect(),
      0,
    ),
  ).toEqual({ root: { children: [decoded] } })
})

test.each([
  {
    ...raw,
    id: 9007199254740992,
  },
  {
    ...raw,
    count: 9007199254740992,
  },
  {
    ...raw,
    active: "false",
  },
  {
    ...raw,
    day: "2026-02-30",
  },
  {
    ...raw,
    bytes: "xyz",
  },
  {
    ...raw,
    title: 1,
  },
])("rejects unsupported nested representations", (row) => {
  expect(() =>
    decodeResultRow({ nested: [row] }, typedQuery.resultShape, undefined, sqliteDialect(), 0),
  ).toThrow(ResultDecodingError)
})

test("rejects malformed array and object shapes", () => {
  for (const nested of [{}, [null], [{}], "not JSON"]) {
    expect(() =>
      decodeResultRow({ nested }, typedQuery.resultShape, undefined, sqliteDialect(), 0),
    ).toThrow(ResultDecodingError)
  }
})

test("rejects unsupported dialects and undeclared value domains", () => {
  expect(() => render(select({ nested: jsonArrayFrom(select({ id: value(1) })) }))).toThrow(
    "Nested JSON queries are not supported",
  )
})

test("rejects an object query without a runtime row-bound proof", () => {
  expect(() => jsonObjectFrom(select(all(items), from(items)) as never)).toThrow("at most one row")
})

test("rejects hidden DISTINCT ordering without changing its projection", () => {
  const query = select({
    names: jsonArrayFrom(
      select({ name: items.displayName }, from(items), distinct(), orderBy(items.id)),
    ),
  })

  expect(() => render(query, sqliteDialect())).toThrow(
    "DISTINCT ordering must use selected expressions",
  )
})

test("decodes numeric text only when JavaScript retains all significant digits", () => {
  const source = table("numbers", {
    amount: numeric(),
    payload: json<unknown>(),
  })
  const query = select({ rows: jsonArrayFrom(select(all(source), from(source))) })
  const decode = (amount: string, payload = '{"fraction":0.1}') =>
    decodeResultRow(
      {
        rows: [
          {
            amount,
            payload,
          },
        ],
      },
      query.resultShape,
      undefined,
      postgresDialect(),
      0,
    )

  expect(decode("1.2500")).toEqual({
    rows: [
      {
        amount: 1.25,
        payload: { fraction: 0.1 },
      },
    ],
  })
  for (const amount of ["0.1234567890123456789", "9007199254740993", "1e999", "not a number"]) {
    expect(() => decode(amount)).toThrow(ResultDecodingError)
  }

  expect(() => decode("1", '{"fraction":0.1234567890123456789}')).toThrow(ResultDecodingError)
  expect(() => decode("1", '{"integer":9007199254740993}')).toThrow(ResultDecodingError)
  expect(decode("1", '{"text":"9007199254740993"}')).toEqual({
    rows: [
      {
        amount: 1,
        payload: { text: "9007199254740993" },
      },
    ],
  })
})

test("passes exact transport values to custom result decoders", () => {
  const source = table("mapped", { id: bigint() })
  const query = select({
    rows: jsonArrayFrom(
      select({ id: mapResult(source.id, (value) => `id:${value}`) }, from(source)),
    ),
  })

  expect(
    decodeResultRow(
      { rows: [{ id: "9007199254740993" }] },
      query.resultShape,
      undefined,
      mysqlDialect(),
      0,
    ),
  ).toEqual({ rows: [{ id: "id:9007199254740993" }] })
})

test("retains built-in computation domains for nested projections", () => {
  const query = select({
    row: jsonObjectFrom(
      select({
        label: upper(cast(value("Ada"), text())),
        total: count(),
        fraction: divide(cast(value(3), integer()), 2),
        choice: caseWhen(eq(cast(value(1), integer()), 1), cast(value(3), integer()), 1.5),
        position: over(rowNumber()),
      }),
    ),
  })

  expect(() => render(query, mysqlDialect())).not.toThrow()
  expect(
    decodeResultRow(
      {
        row: {
          label: "ADA",
          total: 1,
          fraction: "1.5",
          choice: "3",
          position: 1,
        },
      },
      query.resultShape,
      undefined,
      mysqlDialect(),
      0,
    ),
  ).toEqual({
    row: {
      label: "ADA",
      total: 1,
      fraction: 1.5,
      choice: 3,
      position: 1,
    },
  })
})

test("evaluates selected and hidden sort keys once before pagination", () => {
  const computed = add(items.id, 5)

  for (const selection of [{ computed }, { computed: items.id }]) {
    const query = select({
      rows: jsonArrayFrom(select(selection, from(items), orderBy(desc(computed)), fetchFirst(2))),
    })

    expect(render(query, postgresDialect()).parameters).toEqual(["computed", 5, 2])
  }
})

test("renders SQLite set branches as derived queries", () => {
  const query = select({
    rows: jsonArrayFrom(
      unionAll(
        select({ id: cast(value(1), integer()) }),
        select({ id: cast(value(2), integer()) }),
      ),
    ),
  })

  expect(render(query, sqliteDialect()).text).toContain("UNION ALL SELECT * FROM (")
})

test("rejects unknown projected domains instead of guessing a result type", () => {
  expect(() =>
    render(select({ rows: jsonArrayFrom(select({ id: value(1) })) }), postgresDialect()),
  ).toThrow("requires a supported declared SQL domain")
})
