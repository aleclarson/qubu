import { expect, expectTypeOf, test } from 'vitest'
import {
  alias,
  cte,
  eq,
  from,
  render,
  scalar,
  select,
  table,
  text,
  unionAll,
  withCte,
  where,
  integer,
} from '../src/index.ts'

const users = table('users', {
  id: integer(),
  name: text(),
})

test('composes a common table expression as a typed source', () => {
  const activeUsers = cte(
    'active_users',
    select({ id: users.id, name: users.name }, from(users))
  )
  const query = select(
    { name: activeUsers.name },
    withCte(activeUsers),
    from(activeUsers)
  )

  expect(render(query).text).toBe(
    'WITH "active_users" AS (SELECT "users"."id" AS "id", "users"."name" AS "name" FROM "users") SELECT "active_users"."name" AS "name" FROM "active_users"'
  )
  expectTypeOf(query.row).toEqualTypeOf<{ name: string }>()
})

test('uses a selected query as a derived table', () => {
  const names = select({ name: users.name }, from(users))
  const derived = alias(names, 'names')
  const query = select({ name: derived.name }, from(derived))

  expect(render(query).text).toBe(
    'SELECT "names"."name" AS "name" FROM (SELECT "users"."name" AS "name" FROM "users") AS "names"'
  )
})

test('composes standard set operations', () => {
  const first = select({ id: users.id }, from(users))
  const second = select({ id: users.id }, from(users))

  expect(render(unionAll(first, second)).text).toBe(
    '(SELECT "users"."id" AS "id" FROM "users") UNION ALL (SELECT "users"."id" AS "id" FROM "users")'
  )
})

test('uses scalar subqueries as expressions', () => {
  const ids = select({ id: users.id }, from(users))
  const query = select(
    {
      name: users.name,
      firstId: scalar(ids),
    },
    from(users),
    where(eq(users.id, 1))
  )

  expect(render(query).text).toBe(
    'SELECT "users"."name" AS "name", (SELECT "users"."id" AS "id" FROM "users") AS "firstId" FROM "users" WHERE ("users"."id" = ?)'
  )
})
