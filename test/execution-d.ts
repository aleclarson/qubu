import { expectTypeOf } from 'vitest'
import {
  execute,
  executeRows,
  from,
  integer,
  qubu,
  select,
  table,
  type ExecutionOptions,
  type ExecutionRequest,
  type ExecutionResult,
  type QubuTransaction,
  type QueryAdapter,
  type QubuClient,
  type QubuTransactionalClient,
  type TransactionOptions,
  type TransactionalQueryAdapter,
} from '../src/index.ts'
import { standardDialect } from '../src/dialects/standard.ts'

const users = table('users', { id: integer() })
const query = select({ id: users.id }, from(users))

const adapter: QueryAdapter = {
  dialect: standardDialect(),
  async execute<TRow extends object>(_request: ExecutionRequest) {
    return { rows: [] as readonly TRow[] }
  },
}

const options: ExecutionOptions = {
  dialect: standardDialect(),
  signal: new AbortController().signal,
}

expectTypeOf(execute(query, adapter, options)).toEqualTypeOf<
  Promise<ExecutionResult<{ id: number }>>
>()
expectTypeOf(execute(adapter, query)).toEqualTypeOf<
  Promise<ExecutionResult<{ id: number }>>
>()
expectTypeOf(executeRows(query, adapter, options)).toEqualTypeOf<
  Promise<readonly { id: number }[]>
>()
expectTypeOf(executeRows(adapter, query)).toEqualTypeOf<
  Promise<readonly { id: number }[]>
>()

const db = qubu(adapter)
expectTypeOf(db).toEqualTypeOf<QubuClient<QueryAdapter>>()
expectTypeOf(db.adapter).toEqualTypeOf<QueryAdapter>()
expectTypeOf(db.execute(query, options)).toEqualTypeOf<
  Promise<ExecutionResult<{ id: number }>>
>()
expectTypeOf(db.rows(query)).toEqualTypeOf<Promise<readonly { id: number }[]>>()

const transactionalAdapter: TransactionalQueryAdapter = {
  dialect: standardDialect(),
  async execute<TRow extends object>(_request: ExecutionRequest) {
    return { rows: [] as readonly TRow[] }
  },
  async transaction<T>(
    callback: (adapter: QueryAdapter) => Promise<T>,
    _options?: TransactionOptions
  ) {
    return callback(transactionalAdapter)
  },
}

const transactionalDb = qubu(transactionalAdapter)
expectTypeOf(transactionalDb).toEqualTypeOf<
  QubuTransactionalClient<TransactionalQueryAdapter>
>()
expectTypeOf(
  transactionalDb.transaction(async transaction => {
    expectTypeOf(transaction).toEqualTypeOf<QubuTransaction>()
    expectTypeOf(transaction.execute(query)).toEqualTypeOf<
      Promise<ExecutionResult<{ id: number }>>
    >()
    expectTypeOf(transaction.rows(query)).toEqualTypeOf<
      Promise<readonly { id: number }[]>
    >()
    // @ts-expect-error Transaction-scoped clients cannot start nested transactions.
    transaction.transaction(query)
    return 1
  })
).toEqualTypeOf<Promise<number>>()

// @ts-expect-error A plain QueryAdapter does not provide transaction orchestration.
db.transaction(async () => 1)

const specializedAdapter = { ...adapter, name: 'application' as const }
expectTypeOf(
  qubu(specializedAdapter).adapter.name
).toEqualTypeOf<'application'>()

declare const result: ExecutionResult<{ id: number }>
expectTypeOf(result.rows).toEqualTypeOf<readonly { id: number }[]>()
expectTypeOf(result.affectedRows).toEqualTypeOf<number | bigint | undefined>()
expectTypeOf(result.changedRows).toEqualTypeOf<number | bigint | undefined>()
expectTypeOf(result.insertId).toEqualTypeOf<
  string | number | bigint | undefined
>()

// @ts-expect-error Execution result fields are readonly.
result.rows = []

const rowOnlyAdapter: QueryAdapter = {
  dialect: standardDialect(),
  // @ts-expect-error Adapters must return a structured execution result.
  async execute<TRow extends object>() {
    return [] as readonly TRow[]
  },
}

void rowOnlyAdapter
