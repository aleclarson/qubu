import { expect, test, vi } from "vitest"

import { sqliteWasmAdapter } from "../adapters/sqlite-wasm/src/index.ts"
import { boolean, date, executeRows, from, json, select, table } from "../src/index.ts"

test("decodes SQLite WASM values according to the typed projection", async () => {
  const records = table("records", {
    active: boolean(),
    date: date(),
    payload: json<{ ok: boolean }>(),
  })
  const statement = {
    columnCount: 3,
    step: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
    get: () => ({ active: 1, date: "2026-01-02", payload: '{"ok":true}' }),
    finalize: vi.fn(),
  }
  const adapter = sqliteWasmAdapter({ prepare: () => statement } as never)
  await expect(
    executeRows(
      select({ active: records.active, date: records.date, payload: records.payload }, from(records)),
      adapter,
    ),
  ).resolves.toEqual([
    { active: true, date: new Date("2026-01-02T00:00:00Z"), payload: { ok: true } },
  ])
  expect(statement.finalize).toHaveBeenCalledOnce()
})
