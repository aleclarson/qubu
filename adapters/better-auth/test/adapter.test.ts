import { expect, test } from 'vitest'
import type { BetterAuthOptions } from 'better-auth/types'
import {
  qubu,
  type ExecutionRequest,
  type QueryAdapter,
  type TransactionalQueryAdapter,
} from 'qubu'
import { mysqlDialect } from 'qubu/mysql'
import { postgresDialect } from 'qubu/postgres'
import { sqliteDialect } from 'qubu/sqlite'
import { createDialect } from 'qubu/core'
import { qubuAdapter } from '@qubu/better-auth'

function fakeClient(dialect: ReturnType<typeof postgresDialect>) {
  const requests: ExecutionRequest[] = []
  const queuedRows: Record<string, unknown>[][] = []
  const adapter: TransactionalQueryAdapter = {
    dialect,
    async execute(request) {
      requests.push(request)
      return { rows: queuedRows.shift() ?? [], affectedRows: 1 }
    },
    async transaction(callback) {
      return callback(adapter)
    },
  }
  return { client: qubu(adapter), requests, queuedRows }
}

const options = {} satisfies BetterAuthOptions
const completeUser = (values: Record<string, unknown>) => ({
  id: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  emailVerified: false,
  image: null,
  createdAt: new Date('2026-08-28T12:00:00.000Z'),
  updatedAt: new Date('2026-08-28T12:00:00.000Z'),
  ...values,
})

test('renders portable filtering, selection, ordering, and pagination', async () => {
  const fake = fakeClient(postgresDialect())
  fake.queuedRows.push([{ id: 'u1', name: 'Ada' }])
  const adapter = qubuAdapter(fake.client)(options)

  await adapter.findMany({
    model: 'user',
    where: [
      {
        field: 'name',
        operator: 'starts_with',
        value: 'ad',
        mode: 'insensitive',
      },
    ],
    select: ['id', 'name'],
    sortBy: { field: 'name', direction: 'desc' },
    limit: 2,
    offset: 3,
  })

  expect(fake.requests[0]?.statement).toEqual({
    text: 'SELECT "user"."id" AS "id", "user"."name" AS "name" FROM "user" WHERE LOWER("user"."name") LIKE $1 ESCAPE \'!\' ORDER BY "user"."name" DESC LIMIT $2 OFFSET $3',
    parameters: ['ad%', 2, 3],
  })
})

test('maps configured physical field names without requiring optional clauses', async () => {
  const fake = fakeClient(postgresDialect())
  fake.queuedRows.push([{ email_address: 'ada@example.com' }])
  const adapter = qubuAdapter(fake.client)({
    user: { fields: { email: 'email_address' } },
  })

  const found = await adapter.findMany<{ email: string }>({
    model: 'user',
    where: [{ field: 'email', value: 'ada@example.com' }],
    select: ['email'],
  })

  expect(found).toEqual([{ email: 'ada@example.com' }])
  expect(fake.requests[0]?.statement.text).toContain(
    '"user"."email_address" AS "email_address"'
  )
})

test('maps configured physical field names in single-row updates', async () => {
  const fake = fakeClient(sqliteDialect() as ReturnType<typeof postgresDialect>)
  const adapter = qubuAdapter(fake.client)({
    user: { fields: { name: 'full_name' } },
  })

  await adapter.update({
    model: 'user',
    where: [{ field: 'id', value: 'u1' }],
    update: { name: 'Grace' },
  })

  expect(fake.requests[0]?.statement.text).toContain(
    'UPDATE "user" SET "full_name" = ?'
  )
})

test('generates a Qubu schema module through Better Auth metadata', async () => {
  const fake = fakeClient(postgresDialect())
  const options = {
    advanced: { database: { generateId: 'serial' as const } },
    user: {
      additionalFields: {
        nickname: { type: 'string' as const, defaultValue: () => 'anonymous' },
      },
    },
  }
  const adapter = qubuAdapter(fake.client)(options)

  const generated = await adapter.createSchema?.(options, 'auth.ts')

  expect(generated).toMatchObject({ path: 'auth.ts', overwrite: true })
  expect(generated?.code).toContain('betterAuthSchemaFromTables')
  expect(generated?.code).toContain('() => undefined')
  expect(generated?.code).toContain('generateId: "serial"')
})

test.each([
  ['postgresql', postgresDialect()],
  ['sqlite', sqliteDialect()],
] as const)(
  'keeps %s single-row mutations atomic and limited',
  async (_name, dialect) => {
    const fake = fakeClient(dialect as ReturnType<typeof postgresDialect>)
    fake.queuedRows.push([completeUser({ name: 'Grace' })])
    fake.queuedRows.push([completeUser({ name: 'Grace' })])
    const adapter = qubuAdapter(fake.client)(options)

    await adapter.update({
      model: 'user',
      where: [{ field: 'name', value: 'Ada' }],
      update: { name: 'Grace' },
    })
    await adapter.consumeOne({
      model: 'user',
      where: [{ field: 'name', value: 'Grace' }],
    })

    expect(fake.requests[0]?.statement.text).toContain(
      'WHERE (("user"."name" = '
    )
    expect(fake.requests[0]?.statement.text).toContain(
      'AND ("user"."id" IN (SELECT "user"."id" AS "id" FROM "user" WHERE ("user"."name" = '
    )
    expect(fake.requests[0]?.statement.text).toContain('LIMIT ')
    expect(fake.requests[0]?.statement.text).toContain('RETURNING ')
    expect(fake.requests[1]?.statement.text).toContain('DELETE FROM "user"')
    expect(fake.requests[1]?.statement.text).toContain('LIMIT ')
    expect(fake.requests[1]?.statement.text).toContain('RETURNING ')
  }
)

test('uses a locked transaction for MySQL single-row consumption', async () => {
  const fake = fakeClient(mysqlDialect() as ReturnType<typeof postgresDialect>)
  fake.queuedRows.push([completeUser({})], [])
  const adapter = qubuAdapter(fake.client)(options)

  const consumed = await adapter.consumeOne({
    model: 'user',
    where: [{ field: 'name', value: 'Ada' }],
  })

  expect(consumed).toMatchObject({ id: 'u1' })
  expect(fake.requests[0]?.statement.text).toContain('LIMIT 1 FOR UPDATE')
  expect(fake.requests[1]?.statement.text).toContain(
    'DELETE FROM `user` WHERE (`user`.`id` = ?)'
  )
})

test('reuses an active Better Auth transaction for MySQL atomic operations', async () => {
  const fake = fakeClient(mysqlDialect() as ReturnType<typeof postgresDialect>)
  fake.queuedRows.push([completeUser({})], [])
  const adapter = qubuAdapter(fake.client)(options)

  await adapter.transaction(transaction =>
    transaction.consumeOne({
      model: 'user',
      where: [{ field: 'id', value: 'u1' }],
    })
  )

  expect(fake.requests.map(request => request.statement.text)).toEqual([
    expect.stringContaining('FOR UPDATE'),
    expect.stringContaining('DELETE FROM `user`'),
  ])
})

test('keeps MySQL Date values in driver parameters', async () => {
  const fake = fakeClient(mysqlDialect() as ReturnType<typeof postgresDialect>)
  const now = new Date('2026-08-28T12:00:00.000Z')
  fake.queuedRows.push([], [completeUser({ createdAt: now, updatedAt: now })])
  const adapter = qubuAdapter(fake.client)(options)

  await adapter.create({
    model: 'user',
    forceAllowId: true,
    data: completeUser({ createdAt: now, updatedAt: now }),
  })

  expect(fake.requests[0]?.statement.parameters).toEqual(
    expect.arrayContaining([now])
  )
})

test('rejects unsupported dialects and non-transactional clients', () => {
  const plain: QueryAdapter = {
    dialect: postgresDialect(),
    async execute() {
      return { rows: [] }
    },
  }
  expect(() => qubuAdapter(qubu(plain))).toThrow(/transactional Qubu client/)

  const unsupported: TransactionalQueryAdapter = {
    dialect: createDialect({ name: 'oracle', placeholder: () => '?' }),
    async execute() {
      return { rows: [] }
    },
    async transaction(callback) {
      return callback(this)
    },
  }
  expect(() => qubuAdapter(qubu(unsupported))).toThrow(
    /supports PostgreSQL, MySQL, and SQLite/
  )
})
