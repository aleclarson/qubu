import { expectTypeOf } from "vitest"

import { standardDialect } from "../src/dialects/standard.ts"
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
  type HookOperation,
  type HookOutcome,
  type QubuHooks,
  type QubuOptions,
  type QubuTransaction,
  type QueryAdapter,
  type QubuClient,
  type QubuTransactionalClient,
  type TransactionOptions,
  type TransactionalQueryAdapter,
} from "../src/index.ts"

const users = table("users", { id: integer() })
const query = select({ id: users.id }, from(users))

const adapter: QueryAdapter = {
  dialect: standardDialect(),
  async execute(_request: ExecutionRequest) {
    return { rows: [] }
  },
}

const options: ExecutionOptions = {
  dialect: standardDialect(),
  signal: new AbortController().signal,
  hookMetadata: {
    operation: "users.list",
    sampled: true,
  },
}

const hooks: QubuHooks = {
  onOperationStart(operation: HookOperation) {
    expectTypeOf(operation.kind).toEqualTypeOf<"execute" | "stream" | "explain" | "transaction">()

    return (outcome: HookOutcome) => {
      expectTypeOf(outcome.durationMs).toBeNumber()
    }
  },
  onHookError(error) {
    expectTypeOf(error).toBeUnknown()
  },
}
const qubuOptions: QubuOptions = { hooks }

// @ts-expect-error Hook metadata values are deliberately limited to scalars.
const invalidOptions: ExecutionOptions = { hookMetadata: { nested: { value: true } } }

void invalidOptions

expectTypeOf(execute(query, adapter, options)).toEqualTypeOf<
  Promise<ExecutionResult<{ id: number }>>
>()
expectTypeOf(execute(adapter, query)).toEqualTypeOf<Promise<ExecutionResult<{ id: number }>>>()
expectTypeOf(executeRows(query, adapter, options)).toEqualTypeOf<
  Promise<readonly { id: number }[]>
>()
expectTypeOf(executeRows(adapter, query)).toEqualTypeOf<Promise<readonly { id: number }[]>>()

const db = qubu(adapter, qubuOptions)

expectTypeOf(db).toEqualTypeOf<QubuClient<QueryAdapter>>()
expectTypeOf(db.adapter).toEqualTypeOf<QueryAdapter>()
expectTypeOf(db.execute(query, options)).toEqualTypeOf<Promise<ExecutionResult<{ id: number }>>>()
expectTypeOf(db.rows(query)).toEqualTypeOf<Promise<readonly { id: number }[]>>()

// @ts-expect-error Standalone execution does not accept hook registration.
execute(query, adapter, { hooks })

const transactionalAdapter: TransactionalQueryAdapter = {
  dialect: standardDialect(),
  async execute(_request: ExecutionRequest) {
    return { rows: [] }
  },
  async transaction<T>(
    callback: (adapter: QueryAdapter) => Promise<T>,
    _options?: TransactionOptions,
  ) {
    return callback(transactionalAdapter)
  },
}

const transactionalDb = qubu(transactionalAdapter)

expectTypeOf(transactionalDb).toEqualTypeOf<QubuTransactionalClient<TransactionalQueryAdapter>>()
expectTypeOf(
  transactionalDb.transaction(async (transaction) => {
    expectTypeOf(transaction).toEqualTypeOf<QubuTransaction>()
    expectTypeOf(transaction.execute(query)).toEqualTypeOf<
      Promise<ExecutionResult<{ id: number }>>
    >()
    expectTypeOf(transaction.rows(query)).toEqualTypeOf<Promise<readonly { id: number }[]>>()
    // @ts-expect-error Transaction-scoped clients cannot start nested transactions.
    transaction.transaction(query)
    return 1
  }),
).toEqualTypeOf<Promise<number>>()

transactionalDb.transaction(async () => 1, {
  hookMetadata: { operation: "users.transaction" },
})

// @ts-expect-error A plain QueryAdapter does not provide transaction orchestration.
db.transaction(async () => 1)

const specializedAdapter = {
  ...adapter,
  name: "application" as const,
}

expectTypeOf(qubu(specializedAdapter).adapter.name).toEqualTypeOf<"application">()

declare const result: ExecutionResult<{ id: number }>
expectTypeOf(result.rows).toEqualTypeOf<readonly { id: number }[]>()
expectTypeOf(result.affectedRows).toEqualTypeOf<number | bigint | undefined>()
expectTypeOf(result.changedRows).toEqualTypeOf<number | bigint | undefined>()
expectTypeOf(result.insertId).toEqualTypeOf<string | number | bigint | undefined>()

// @ts-expect-error Execution result fields are readonly.
result.rows = []

const rowOnlyAdapter: QueryAdapter = {
  dialect: standardDialect(),
  // @ts-expect-error Adapters must return a structured execution result.
  async execute() {
    return []
  },
}

void rowOnlyAdapter
