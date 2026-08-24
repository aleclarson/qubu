import { expectTypeOf } from 'vitest'
import {
  explain,
  from,
  insertInto,
  integer,
  qubu,
  select,
  table,
  values,
  type ExecutionRequest,
  type ExplainableQueryAdapter,
  type ExplainOptions,
  type ExplainResult,
  type QubuClient,
  type QubuExplainableClient,
  type QueryAdapter,
} from '../src/index.ts'
import { postgresDialect } from '../src/dialects/postgres.ts'

type PlanRow = { 'QUERY PLAN': string }

const users = table('users', { id: integer() })
const query = select({ id: users.id }, from(users))
const mutation = insertInto(users, values({ id: 7 }))

const adapter: ExplainableQueryAdapter<PlanRow> = {
  dialect: postgresDialect(),
  async execute<TRow extends object>(_request: ExecutionRequest) {
    return { rows: [] as readonly TRow[] }
  },
  async explain(_request) {
    return { rows: [] as readonly PlanRow[] }
  },
}

const options: ExplainOptions = {
  analyze: true,
  dialect: postgresDialect(),
  signal: new AbortController().signal,
}

expectTypeOf(explain(query, adapter, options)).toEqualTypeOf<
  Promise<ExplainResult<PlanRow>>
>()
expectTypeOf(explain(adapter, query)).toEqualTypeOf<
  Promise<ExplainResult<PlanRow>>
>()

const db = qubu(adapter)
expectTypeOf(db).toEqualTypeOf<
  QubuExplainableClient<ExplainableQueryAdapter<PlanRow>>
>()
expectTypeOf(db.explain(query)).toEqualTypeOf<Promise<ExplainResult<PlanRow>>>()

// Mutation EXPLAIN stays plan-only. The type boundary rejects analysis.
// @ts-expect-error Mutations cannot request EXPLAIN ANALYZE.
explain(mutation, adapter, { analyze: true })

const plainAdapter: QueryAdapter = {
  dialect: postgresDialect(),
  async execute<TRow extends object>(_request: ExecutionRequest) {
    return { rows: [] as readonly TRow[] }
  },
}
const plainDb = qubu(plainAdapter)
expectTypeOf(plainDb).toEqualTypeOf<QubuClient<QueryAdapter>>()
// @ts-expect-error A plain QueryAdapter does not expose explain().
plainDb.explain(query)
