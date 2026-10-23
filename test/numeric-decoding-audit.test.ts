import { expect, test } from "vitest"

import { pgAdapter } from "../adapters/pg/src/index.ts"
import { pgliteAdapter } from "../adapters/pglite/src/index.ts"
import {
  add,
  bigint,
  cast,
  count,
  executeRows,
  mapResult,
  numeric,
  select,
  value,
} from "../src/index.ts"

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

for (const name of ["pg", "pglite"] as const) {
  test.each(["0.5", "9007199254740993.125"])(
    `preserves the driver's exact PostgreSQL NUMERIC text through ${name} (%s)`,
    async (amount) => {
      const query = select({ amount: cast(value(amount), numeric()) })

      // NUMERIC conversion belongs to driver/application policy, including
      // values that cannot be represented exactly by a JavaScript number.
      await expect(executeRows(query, adapter(name, amount))).resolves.toEqual([{ amount }])
    },
  )

  test(`applies an explicit NUMERIC result conversion through ${name}`, async () => {
    const query = select({ amount: mapResult(cast(value(0.5), numeric()), Number) })

    await expect(executeRows(query, adapter(name, "0.5"))).resolves.toEqual([{ amount: 0.5 }])
  })
}

test("preserves a PostgreSQL COUNT driver string without an explicit conversion", async () => {
  const query = select({ amount: count() })

  await expect(executeRows(query, adapter("pg", "1"))).resolves.toEqual([{ amount: "1" }])
})

test("applies an explicit PostgreSQL COUNT result conversion", async () => {
  const query = select({ amount: mapResult(count(), Number) })

  await expect(executeRows(query, adapter("pg", "1"))).resolves.toEqual([{ amount: 1 }])
})

test("decodes exact PostgreSQL BIGINT arithmetic results through pg", async () => {
  const query = select({ amount: add(cast(value(9007199254740992n), bigint()), 1n) })

  await expect(executeRows(query, adapter("pg", "9007199254740993"))).resolves.toEqual([
    { amount: 9007199254740993n },
  ])
})

test("decodes a direct PostgreSQL BIGINT projection through pg", async () => {
  const query = select({ amount: cast(value(9007199254740993n), bigint()) })

  await expect(executeRows(query, adapter("pg", "9007199254740993"))).resolves.toEqual([
    { amount: 9007199254740993n },
  ])
})

test.each(["pg", "pglite"] as const)(
  "preserves a PostgreSQL NUMERIC result already parsed as a number through %s",
  async (name) => {
    const query = select({ amount: cast(value(0.5), numeric()) })

    await expect(executeRows(query, adapter(name, 0.5))).resolves.toEqual([{ amount: 0.5 }])
  },
)
