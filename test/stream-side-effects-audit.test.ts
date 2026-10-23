import { expect, test } from "vitest"

import { postgresDialect } from "../src/dialects/postgres.ts"
import {
  allowAll,
  cte,
  deleteFrom,
  from,
  integer,
  returning,
  select,
  stream,
  table,
  withCte,
  type ExecutionRequest,
  type StreamingQueryAdapter,
} from "../src/index.ts"

test.each([false, true])(
  "streams outer SELECT queries with CTEs (writable: %s)",
  async (writable) => {
    const records = table("audit_stream_records", { id: integer() })
    const source = cte(
      "selected_records",
      writable
        ? deleteFrom(records, allowAll(), returning({ id: records.id }))
        : select({ id: records.id }, from(records)),
    )
    const query = select({ id: source.id }, withCte(source), from(source))
    const requests: ExecutionRequest[] = []
    const adapter: StreamingQueryAdapter = {
      dialect: postgresDialect(),
      async execute() {
        throw new Error("Streaming must use the stream boundary")
      },
      stream(request) {
        requests.push(request)
        return (async function* () {
          yield { id: 1 }
        })()
      },
    }

    const rows = []

    for await (const row of stream(query, adapter)) {
      rows.push(row)
    }

    expect(rows).toEqual([{ id: 1 }])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.queryKind).toBe("select")
    expect(requests[0]?.statement.text).toContain(writable ? "AS (DELETE FROM" : "AS (SELECT")
  },
)
