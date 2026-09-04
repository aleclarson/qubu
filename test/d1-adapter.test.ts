import { expect, test, vi } from "vitest"

import { d1Adapter } from "../adapters/cloudflare-d1/src/index.ts"
import type { ExecutionRequest } from "../src/execution.ts"
import { boolean, date, executeRows, from, json, select, table } from "../src/index.ts"

test("decodes D1 values according to the typed query projection", async () => {
  const records = table("records", {
    active: boolean(),
    date: date(),
    payload: json<{ ok: boolean }>(),
  })
  const statement = {
    bind: vi.fn(),
    all: async () => ({
      results: [
        {
          active: 1,
          date: "2026-01-02",
          payload: '{"ok":true}',
        },
      ],
    }),
  }

  statement.bind.mockReturnValue(statement)
  const adapter = d1Adapter({ prepare: () => statement } as never)

  await expect(
    executeRows(
      select(
        {
          active: records.active,
          date: records.date,
          payload: records.payload,
        },
        from(records),
      ),
      adapter,
    ),
  ).resolves.toEqual([
    {
      active: true,
      date: new Date("2026-01-02T00:00:00Z"),
      payload: { ok: true },
    },
  ])
})

test("rejects unsupported encoded D1 values and omits invalid insert metadata", async () => {
  const statement = {
    bind: vi.fn(),
    run: vi.fn(async () => ({
      meta: {
        changes: 0,
        last_row_id: 42,
      },
    })),
  }

  statement.bind.mockReturnValue(statement)
  const database = { prepare: () => statement }
  const request: ExecutionRequest = {
    queryKind: "insert",
    resultShape: { fields: [] },
    statement: {
      text: "INSERT",
      parameters: [],
    },
  }
  const adapter = d1Adapter(database as never)

  await expect(adapter.execute(request)).resolves.toEqual({
    rows: [],
    affectedRows: 0,
  })
  statement.run.mockResolvedValueOnce({
    meta: {
      changes: 1,
      last_row_id: Number.MAX_SAFE_INTEGER + 1,
    },
  })
  await expect(adapter.execute(request)).resolves.toEqual({
    rows: [],
    affectedRows: 1,
  })
  const invalid = d1Adapter(database as never, { encoder: { encode: () => ({ invalid: true }) } })

  await expect(
    invalid.execute({
      ...request,
      statement: {
        text: "INSERT",
        parameters: [1],
      },
    }),
  ).rejects.toThrow(/D1 parameters/)
})
