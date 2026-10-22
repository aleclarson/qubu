import { expect, test } from "vitest"

import { pgAdapter } from "../adapters/pg/src/index.ts"
import { pgliteAdapter } from "../adapters/pglite/src/index.ts"
import { cast, count, executeRows, numeric, select, value } from "../src/index.ts"

function adapter(name: "pg" | "pglite", amount: string | number) {
  const client = {
    async query() {
      return {
        rows: [{ amount }],
        rowCount: 1,
      }
    },
  }

  return name === "pg" ? pgAdapter(client as never) : pgliteAdapter(client as never)
}

test.each(["pg", "pglite"] as const)(
  "decodes an exactly representable PostgreSQL NUMERIC result through %s",
  async (name) => {
    const query = select({ amount: cast(value(0.5), numeric()) })

    // PostgreSQL clients return NUMERIC in text form by default. numeric()
    // declares a number output; this value needs no lossy precision conversion.
    await expect(executeRows(query, adapter(name, "0.5"))).resolves.toEqual([{ amount: 0.5 }])
  },
)

test("decodes a safely represented PostgreSQL COUNT result through pg", async () => {
  const query = select({ amount: count() })

  await expect(executeRows(query, adapter("pg", "1"))).resolves.toEqual([{ amount: 1 }])
})

test.each(["pg", "pglite"] as const)(
  "preserves a PostgreSQL NUMERIC result already parsed as a number through %s",
  async (name) => {
    const query = select({ amount: cast(value(0.5), numeric()) })

    await expect(executeRows(query, adapter(name, 0.5))).resolves.toEqual([{ amount: 0.5 }])
  },
)
