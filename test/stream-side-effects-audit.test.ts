import { expect, test } from "vitest"

import { postgresDialect } from "../src/dialects/postgres.ts"
import {
  allowAll,
  cte,
  deleteFrom,
  from,
  integer,
  QueryValidationError,
  returning,
  select,
  stream,
  table,
  withCte,
  type ExecutionRequest,
  type StreamingQueryAdapter,
} from "../src/index.ts"

test.each([false, true])(
  "only streams CTE queries that have no mutation (writable: %s)",
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

    if (writable) {
      expect(() => Reflect.apply(stream, undefined, [query, adapter])).toThrowError(
        QueryValidationError,
      )
      expect(requests).toEqual([])
    } else {
      const rows = []

      for await (const row of Reflect.apply(stream, undefined, [query, adapter])) {
        rows.push(row)
      }

      expect(rows).toEqual([{ id: 1 }])
      expect(requests).toHaveLength(1)
    }
  },
)
