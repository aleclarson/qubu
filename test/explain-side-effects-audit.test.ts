import { expect, test } from "vitest"

import { postgresDialect } from "../src/dialects/postgres.ts"
import {
  allowAll,
  cte,
  deleteFrom,
  explain,
  from,
  integer,
  returning,
  select,
  table,
  withCte,
  type ExplainableQueryAdapter,
  type ExplainRequest,
} from "../src/index.ts"

test.each([false, true])(
  "keeps a SELECT with a writable CTE plan-only during EXPLAIN (analyze: %s)",
  async (analyze) => {
    const records = table("audit_explain_records", { id: integer() })
    const removed = cte("removed", deleteFrom(records, allowAll(), returning({ id: records.id })))
    const query = select({ id: removed.id }, withCte(removed), from(removed))
    const requests: ExplainRequest[] = []
    const adapter: ExplainableQueryAdapter = {
      dialect: postgresDialect(),
      async execute() {
        throw new Error("EXPLAIN must use the plan boundary")
      },
      async explain(request) {
        requests.push(request)
        return { rows: [] }
      },
    }

    if (analyze) {
      await expect(
        Reflect.apply(explain, undefined, [query, adapter, { analyze }]),
      ).rejects.toMatchObject({
        code: "invalid-explain-query",
        path: ["analyze"],
      })
      expect(requests).toEqual([])
    } else {
      await expect(explain(query, adapter)).resolves.toEqual({ rows: [] })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.statement.text).toContain('WITH "removed" AS (DELETE FROM')
      expect(requests[0]?.statement.text).not.toContain("ANALYZE")
    }
  },
)
