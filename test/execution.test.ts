import { expect, expectTypeOf, test } from 'vitest'
import {
  eq,
  execute,
  from,
  integer,
  render,
  select,
  table,
  where,
  type RenderedQuery,
  type QueryAdapter,
} from '../src/index.ts'
import { standardDialect } from '../src/dialects/standard.ts'

const users = table('users', { id: integer() })

test('executes through a driver-owned adapter boundary', async () => {
  let received: ReturnType<typeof render> | undefined
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>(statement: RenderedQuery) {
      received = statement
      return [{ id: 7 }] as unknown as readonly TRow[]
    },
  }
  const query = select({ id: users.id }, from(users), where(eq(users.id, 7)))

  const rows = await execute(query, adapter)

  expect(received).toEqual({
    text: 'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = ?)',
    parameters: [7],
  })
  expect(rows).toEqual([{ id: 7 }])
  expectTypeOf(rows).toEqualTypeOf<readonly { id: number }[]>()
})
