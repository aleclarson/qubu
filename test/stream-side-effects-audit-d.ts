import { postgresDialect } from "../src/dialects/postgres.ts"
import {
  allowAll,
  cte,
  deleteFrom,
  from,
  integer,
  qubu,
  returning,
  select,
  stream,
  table,
  withCte,
  type StreamingQueryAdapter,
} from "../src/index.ts"

const records = table("audit_stream_records", { id: integer() })
const removed = cte("removed", deleteFrom(records, allowAll(), returning({ id: records.id })))
const writable = select({ id: removed.id }, withCte(removed), from(removed))
const ordinary = cte("ordinary", select({ id: records.id }, from(records)))
const readOnly = select({ id: ordinary.id }, withCte(ordinary), from(ordinary))
const adapter: StreamingQueryAdapter = {
  dialect: postgresDialect(),
  async execute() {
    return { rows: [] }
  },
  stream() {
    return (async function* () {})()
  },
}

stream(readOnly, adapter)
qubu(adapter).stream(readOnly)

// Eligibility follows the outer SELECT kind, not the CTE's side effects.
stream(writable, adapter)
qubu(adapter).stream(writable)

const mutation = deleteFrom(records, allowAll(), returning({ id: records.id }))

// @ts-expect-error Direct mutations must use execute or executeRows.
stream(mutation, adapter)
// @ts-expect-error Bound clients enforce the same mutation restriction.
qubu(adapter).stream(mutation)
