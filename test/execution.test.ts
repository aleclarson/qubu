import { expect, expectTypeOf, test } from 'vitest'
import {
  eq,
  execute,
  executeRows,
  from,
  insertInto,
  integer,
  qubu,
  returning,
  select,
  table,
  values,
  where,
  type ExecutionRequest,
  type QueryAdapter,
  type TransactionOptions,
  type TransactionalQueryAdapter,
} from '../src/index.ts'
import { postgresDialect } from '../src/dialects/postgres.ts'
import { standardDialect } from '../src/dialects/standard.ts'

const users = table('users', { id: integer() })

test('passes the rendered query kind and abort signal to the adapter', async () => {
  let received: ExecutionRequest | undefined
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      received = request
      return {
        rows: [{ id: 7 }] as unknown as readonly TRow[],
      }
    },
  }
  const query = select({ id: users.id }, from(users), where(eq(users.id, 7)))
  const controller = new AbortController()

  const result = await execute(query, adapter, {
    dialect: postgresDialect(),
    signal: controller.signal,
  })

  expect(received).toEqual({
    statement: {
      text: 'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = $1)',
      parameters: [7],
    },
    queryKind: 'select',
    signal: controller.signal,
  })
  expect(result).toEqual({ rows: [{ id: 7 }] })
  expectTypeOf(result.rows).toEqualTypeOf<readonly { id: number }[]>()
})

test('returns mutation facts and unwraps rows on request', async () => {
  const requests: ExecutionRequest[] = []
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      requests.push(request)
      return {
        rows: [{ id: 8 }] as unknown as readonly TRow[],
        affectedRows: 1n,
        changedRows: 1,
        insertId: '8',
      }
    },
  }
  const query = insertInto(
    users,
    values({ id: 8 }),
    returning({ id: users.id })
  )

  const result = await execute(query, adapter)
  const rows = await executeRows(adapter, query)

  expect(result).toEqual({
    rows: [{ id: 8 }],
    affectedRows: 1n,
    changedRows: 1,
    insertId: '8',
  })
  expect(rows).toEqual([{ id: 8 }])
  expect(requests.map(request => request.queryKind)).toEqual([
    'insert',
    'insert',
  ])
  expectTypeOf(rows).toEqualTypeOf<readonly { id: number }[]>()
})

test('binds one adapter for structured and row-only execution', async () => {
  const requests: ExecutionRequest[] = []
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      requests.push(request)
      return {
        rows: [{ id: 7 }] as unknown as readonly TRow[],
        affectedRows: 1,
      }
    },
  }
  const db = qubu(adapter)
  const query = select({ id: users.id }, from(users), where(eq(users.id, 7)))

  const result = await db.execute(query, { dialect: postgresDialect() })
  const rows = await db.rows(query)

  expect(db.adapter).toBe(adapter)
  expect(result).toEqual({ rows: [{ id: 7 }], affectedRows: 1 })
  expect(rows).toEqual([{ id: 7 }])
  expect(requests.map(request => request.statement.text)).toEqual([
    'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = $1)',
    'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = ?)',
  ])
})

test('binds a transaction-scoped client to the adapter transaction', async () => {
  const events: string[] = []
  const controller = new AbortController()
  const query = select({ id: users.id }, from(users), where(eq(users.id, 7)))
  const transactionAdapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      events.push(`execute:${request.queryKind}`)
      return { rows: [{ id: 7 }] as unknown as readonly TRow[] }
    },
  }
  const adapter: TransactionalQueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>(): Promise<{ rows: readonly TRow[] }> {
      throw new Error('The root adapter should not execute inside this test.')
    },
    async transaction<T>(
      callback: (adapter: QueryAdapter) => Promise<T>,
      options?: TransactionOptions
    ) {
      expect(options?.signal).toBe(controller.signal)
      events.push('begin')
      const result = await callback(transactionAdapter)
      events.push('commit')
      return result
    },
  }

  const result = await qubu(adapter).transaction(
    async transaction => {
      expect(transaction.adapter).toBe(transactionAdapter)
      expect('transaction' in transaction).toBe(false)
      await expect(transaction.rows(query)).resolves.toEqual([{ id: 7 }])
      return 'committed'
    },
    { signal: controller.signal }
  )

  expect(result).toBe('committed')
  expect(events).toEqual(['begin', 'execute:select', 'commit'])
})

test('preserves a rejected transaction callback through the adapter', async () => {
  const events: string[] = []
  const failure = new Error('transaction callback failed')
  const transactionAdapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>() {
      return { rows: [] as readonly TRow[] }
    },
  }
  const adapter: TransactionalQueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>(): Promise<{ rows: readonly TRow[] }> {
      throw new Error('The root adapter should not execute inside this test.')
    },
    async transaction<T>(callback: (adapter: QueryAdapter) => Promise<T>) {
      events.push('begin')
      try {
        const result = await callback(transactionAdapter)
        events.push('commit')
        return result
      } catch (error) {
        events.push('rollback')
        throw error
      } finally {
        events.push('release')
      }
    },
  }

  await expect(
    qubu(adapter).transaction(async () => {
      throw failure
    })
  ).rejects.toBe(failure)
  expect(events).toEqual(['begin', 'rollback', 'release'])
})
