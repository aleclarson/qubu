import { expectTypeOf } from "vitest"

import { standardDialect } from "../src/dialects/standard.ts"
import {
  from,
  insertInto,
  integer,
  qubu,
  returning,
  select,
  stream,
  table,
  unionAll,
  values,
  type ExecutionRequest,
  type ExecutionResult,
  type QubuClient,
  type QubuStreamingClient,
  type QubuStreamingTransaction,
  type QubuStreamingTransactionalClient,
  type StreamableQuery,
  type StreamingQueryAdapter,
  type StreamingTransactionalQueryAdapter,
  type QueryAdapter,
} from "../src/index.ts"

const users = table("users", { id: integer() })
const query = select({ id: users.id }, from(users))
const setQuery = unionAll(query, select({ id: users.id }, from(users)))
const mutation = insertInto(users, values({ id: 7 }), returning({ id: users.id }))

const streamingAdapter: StreamingQueryAdapter = {
  dialect: standardDialect(),
  async execute(_request: ExecutionRequest) {
    return { rows: [] }
  },
  stream(_request: ExecutionRequest) {
    return (async function* () {
      yield {}
    })()
  },
}

expectTypeOf(stream(query, streamingAdapter)).toEqualTypeOf<AsyncIterable<{ id: number }>>()
expectTypeOf(stream(streamingAdapter, setQuery)).toEqualTypeOf<AsyncIterable<{ id: number }>>()
expectTypeOf(streamingAdapter.stream({} as ExecutionRequest)).toEqualTypeOf<
  AsyncIterable<Readonly<Record<string, unknown>>>
>()

// @ts-expect-error Mutations, including RETURNING mutations, are materialized.
stream(mutation, streamingAdapter)

const streamingDb = qubu(streamingAdapter)

expectTypeOf(streamingDb).toEqualTypeOf<QubuStreamingClient<StreamingQueryAdapter>>()
expectTypeOf(streamingDb.stream(query)).toEqualTypeOf<AsyncIterable<{ id: number }>>()
expectTypeOf(streamingDb.execute(query)).toEqualTypeOf<Promise<ExecutionResult<{ id: number }>>>()

const materializedAdapter: QueryAdapter = {
  dialect: standardDialect(),
  async execute(_request: ExecutionRequest) {
    return { rows: [] }
  },
}
const materializedDb = qubu(materializedAdapter)

expectTypeOf(materializedDb).toEqualTypeOf<QubuClient<QueryAdapter>>()
// @ts-expect-error A plain QueryAdapter does not expose stream().
materializedDb.stream(query)

const streamingTransactionalAdapter: StreamingTransactionalQueryAdapter = {
  dialect: standardDialect(),
  async execute(_request: ExecutionRequest) {
    return { rows: [] }
  },
  stream(_request: ExecutionRequest) {
    return (async function* () {
      yield {}
    })()
  },
  async transaction<T>(callback: (adapter: StreamingQueryAdapter) => Promise<T>) {
    return callback(streamingTransactionalAdapter)
  },
}

const streamingTransactionalDb = qubu(streamingTransactionalAdapter)

expectTypeOf(streamingTransactionalDb).toEqualTypeOf<
  QubuStreamingTransactionalClient<StreamingTransactionalQueryAdapter>
>()
expectTypeOf(
  streamingTransactionalDb.transaction(async (transaction) => {
    expectTypeOf(transaction).toEqualTypeOf<QubuStreamingTransaction>()
    expectTypeOf(transaction.stream(query)).toEqualTypeOf<AsyncIterable<{ id: number }>>()
    // @ts-expect-error Transaction-scoped clients cannot start nested transactions.
    transaction.transaction(async () => 1)
    return 1
  }),
).toEqualTypeOf<Promise<number>>()

const declaredStreamable: StreamableQuery<{ id: number }> = query

void declaredStreamable
