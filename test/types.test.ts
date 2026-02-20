import { expectTypeOf, test } from 'vitest'
import { from, select, SQL } from 'qubu'
import { posts, users } from './common/schema.ts'

test('select all columns from a single table', () => {
  const query = select(users.$getAll(), from(users))
  type Result = SQL.InferOutput<typeof query>
  
  expectTypeOf<Result>().toEqualTypeOf<{
    id: string
    name: string | null
  }[]>()
})

test('select specific columns', () => {
  const query = select(users.id, users.name, from(users))
  type Result = SQL.InferOutput<typeof query>

  expectTypeOf<Result>().toEqualTypeOf<{
    id: string
    name: string | null
  }[]>()
})

test('select with column alias', () => {
  const query = select(users.name.as('username'), from(users))
  type Result = SQL.InferOutput<typeof query>

  expectTypeOf<Result>().toEqualTypeOf<{
    username: string | null
  }[]>()
})

test('select with table alias', () => {
  const u = users.as('u')
  const query = select(u.name, from(u))
  type Result = SQL.InferOutput<typeof query>

  expectTypeOf<Result>().toEqualTypeOf<{
    name: string | null
  }[]>()
})

test('select from multiple tables (join)', () => {
  const query = select(users.name, posts.body, from(users, posts))
  type Result = SQL.InferOutput<typeof query>

  expectTypeOf<Result>().toEqualTypeOf<{
    name: string | null
    body: string
  }[]>()
})

test('select with object literal', () => {
  const query = select({
    userName: users.name,
    postContent: posts.body
  }, from(users, posts))
  type Result = SQL.InferOutput<typeof query>

  expectTypeOf<Result>().toEqualTypeOf<{
    userName: string | null
    postContent: string
  }[]>()
})
