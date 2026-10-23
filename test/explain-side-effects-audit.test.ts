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
  "uses the outer SELECT kind for writable-CTE EXPLAIN eligibility (analyze: %s)",
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

    await expect(explain(query, adapter, { analyze })).resolves.toEqual({ rows: [] })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.statement.text).toContain('WITH "removed" AS (DELETE FROM')
    if (analyze) {
      expect(requests[0]?.statement.text).toContain("ANALYZE")
    } else {
      expect(requests[0]?.statement.text).not.toContain("ANALYZE")
    }
  },
)
