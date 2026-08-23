import { expect, expectTypeOf, test } from 'vitest'
import {
  eq,
  execute,
  executeRows,
  from,
  insertInto,
  integer,
  returning,
  select,
  table,
  values,
  where,
  type ExecutionRequest,
  type QueryAdapter,
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
