import { expect, test, vi } from "vitest"

import { planetscaleAdapter } from "../adapters/planetscale/src/index.ts"
import type { ExecutionRequest } from "../src/execution.ts"
import { boolean, date, executeRows, from, select, table } from "../src/index.ts"

test("formats bound PlanetScale queries once in root and transaction scopes", async () => {
  const execute = vi.fn(async (..._args: unknown[]) => ({
    rows: [],
    rowsAffected: 0,
    insertId: "0",
  }))
  const format = vi.fn(() => "SELECT '?' AS literal, '{\"ok\":true}' AS payload /* ? */")
  const client = {
    config: { format },
    execute,
    transaction: async (callback: (executor: { execute: typeof execute }) => Promise<unknown>) =>
      callback({ execute }),
  }
  const adapter = planetscaleAdapter(client as never)
  const request: ExecutionRequest = {
    queryKind: "insert",
    resultShape: { fields: [] },
    statement: {
      text: "SELECT '?' AS literal, ? AS payload /* ? */",
      parameters: [{ ok: true }],
    },
  }

  await expect(adapter.execute(request)).resolves.toEqual({
    rows: [],
    affectedRows: 0,
  })
  await adapter.transaction((scoped) => scoped.execute(request))
  await adapter.explain(request)
  expect(format).toHaveBeenCalledTimes(3)
  expect(format).toHaveBeenCalledWith(request.statement.text, ['{"ok":true}'])
  expect(execute.mock.calls.every((call) => call.length === 1)).toBe(true)
})

test("decodes typed PlanetScale booleans and dates", async () => {
  const records = table("records", {
    active: boolean(),
    date: date(),
  })
  const adapter = planetscaleAdapter({
    execute: async () => ({
      rows: [
        {
          active: 1,
          date: "2026-01-02",
        },
      ],
    }),
  } as never)

  await expect(
    executeRows(
      select(
        {
          active: records.active,
          date: records.date,
        },
        from(records),
      ),
      adapter,
    ),
  ).resolves.toEqual([
    {
      active: true,
      date: new Date("2026-01-02T00:00:00Z"),
    },
  ])
  expect(() =>
    planetscaleAdapter({
      config: {},
      execute: vi.fn(),
    } as never),
  ).toThrow(/SQL-aware formatter/)
})
