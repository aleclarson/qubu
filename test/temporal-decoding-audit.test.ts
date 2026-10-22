import { execFileSync } from "node:child_process"

import { expect, test } from "vitest"

import { postgresDialect } from "../src/dialects/postgres.ts"
import { timestampResultDecoder } from "../src/index.ts"

test.each([
  ["2026-08-27 07:00:00-05", "2026-08-27T12:00:00.000Z"],
  ["2026-08-27 12:00:00+00", "2026-08-27T12:00:00.000Z"],
  ["2026-08-27 07:00:00-05:00", "2026-08-27T12:00:00.000Z"],
])("decodes the PostgreSQL timestamp text %s", (input, expected) => {
  expect(
    timestampResultDecoder(input, {
      dialect: postgresDialect(),
      field: "at",
      rowIndex: 0,
    }),
  ).toEqual(new Date(expected))
})

test.each(["America/New_York", "Asia/Tokyo", "UTC"])(
  "keeps the SQL DATE calendar day at UTC midnight with pg in %s",
  (timezone) => {
    // Exercise pg's actual default DATE parser in an isolated timezone without
    // changing the test worker's global TZ or depending on the host timezone.
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import pg from "pg"
         import { pgAdapter } from ${JSON.stringify(new URL("../adapters/pg/src/index.ts", import.meta.url).href)}
         import { cast, date, executeRows, select, value } from ${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)}
         const day = pg.types.getTypeParser(1082)("2026-08-27")
         const adapter = pgAdapter({
           async query() { return { rows: [{ day }], rowCount: 1 } }
         })
         const query = select({ day: cast(value("2026-08-27"), date()) })
         process.stdout.write(JSON.stringify(await executeRows(query, adapter)))`,
      ],
      {
        encoding: "utf8",
        cwd: new URL("../", import.meta.url),
        env: {
          ...process.env,
          TZ: timezone,
        },
      },
    )

    expect(JSON.parse(output)).toEqual([{ day: "2026-08-27T00:00:00.000Z" }])
  },
)
