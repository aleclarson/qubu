import type { Client, InValue, Row, TransactionMode } from '@libsql/client'
import { expectTypeOf } from 'vitest'
import { qubu } from '../src/index.ts'
import {
  libsqlAdapter,
  type LibsqlAdapter,
  type LibsqlAdapterOptions,
  type LibsqlTransactionAdapter,
} from '../adapters/libsql/src/index.ts'
import type {
  QubuExplainableClient,
  QubuExplainableTransactionalClient,
} from '../src/execution.ts'

declare const client: Client

const options: LibsqlAdapterOptions = {
  transactionMode: 'write' satisfies TransactionMode,
  encoder: {
    encode(value): InValue {
      return String(value)
    },
  },
}
const adapter = libsqlAdapter(client, options)

expectTypeOf(adapter).toEqualTypeOf<LibsqlAdapter>()
expectTypeOf(adapter.client).toEqualTypeOf<Client>()
expectTypeOf(adapter.transactionMode).toEqualTypeOf<TransactionMode>()

const db = qubu(adapter)
expectTypeOf(db).toEqualTypeOf<
  QubuExplainableTransactionalClient<LibsqlAdapter, LibsqlTransactionAdapter>
>()

db.transaction(async transaction => {
  expectTypeOf(transaction).toEqualTypeOf<
    QubuExplainableClient<LibsqlTransactionAdapter>
  >()
  const plan = await transaction.explain({} as never)
  expectTypeOf(plan.rows).toEqualTypeOf<readonly Row[]>()
})

// @ts-expect-error libSQL exposes materialized results, not a Qubu row stream.
db.stream({} as never)
