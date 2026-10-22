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

// @ts-expect-error A writable CTE must keep the complete query's analysis disabled.
explain(query, adapter, { analyze: true })

// @ts-expect-error Bound clients must also reject analysis of a writable CTE.
qubu(adapter).explain(query, { analyze: true })
