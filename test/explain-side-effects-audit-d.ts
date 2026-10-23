import { postgresDialect } from "../src/dialects/postgres.ts"
import {
  allowAll,
  cte,
  deleteFrom,
  explain,
  from,
  integer,
  qubu,
  returning,
  select,
  table,
  withCte,
  type ExplainableQueryAdapter,
} from "../src/index.ts"

const records = table("audit_explain_records", { id: integer() })
const removed = cte("removed", deleteFrom(records, allowAll(), returning({ id: records.id })))
const query = select({ id: removed.id }, withCte(removed), from(removed))
const adapter: ExplainableQueryAdapter = {
  dialect: postgresDialect(),
  async execute() {
    return { rows: [] }
  },
  async explain() {
    return { rows: [] }
  },
}

explain(query, adapter)
qubu(adapter).explain(query)

// Eligibility follows the outer SELECT kind, not the CTE's side effects.
explain(query, adapter, { analyze: true })
qubu(adapter).explain(query, { analyze: true })

const mutation = deleteFrom(records, allowAll(), returning({ id: records.id }))

// @ts-expect-error Direct mutation query kinds cannot request analysis.
explain(mutation, adapter, { analyze: true })
// @ts-expect-error Bound clients enforce the same mutation restriction.
qubu(adapter).explain(mutation, { analyze: true })
