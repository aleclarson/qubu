import { expect, expectTypeOf, test } from 'vitest'
import { mysqlDialect } from '../src/dialects/mysql.ts'
import {
  add,
  alias,
  cast,
  cte,
  eq,
  from,
  render,
  recursiveCte,
  scalar,
  select,
  table,
  text,
  unionAll,
  withCte,
  where,
  integer,
  value,
  lt,
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

test('renders recursive CTEs with one portable compound body', () => {
  const anchor = select({ currentValue: cast(value(1), integer()) })
  expectTypeOf(anchor.row).toEqualTypeOf<{ currentValue: number }>()
  const numbers = recursiveCte('numbers', anchor, self =>
    select(
      { currentValue: add(self.currentValue, 1) },
      from(self),
      where(lt(self.currentValue, 3))
    )
  )
  const ordinary = cte('ordinary', select({ id: users.id }, from(users)))
  const query = select(
    { currentValue: numbers.currentValue },
    withCte(ordinary, numbers),
    from(numbers)
  )

  expect(render(query)).toEqual({
    text: 'WITH RECURSIVE "ordinary" AS (SELECT "users"."id" AS "id" FROM "users"), "numbers" ("current_value") AS (SELECT CAST(? AS INTEGER) AS "current_value" UNION ALL SELECT ("numbers"."current_value" + ?) AS "current_value" FROM "numbers" WHERE ("numbers"."current_value" < ?)) SELECT "numbers"."current_value" AS "currentValue" FROM "numbers"',
    parameters: [1, 1, 3],
  })
  expect(render(query, mysqlDialect())).toEqual({
    text: 'WITH RECURSIVE `ordinary` AS (SELECT `users`.`id` AS `id` FROM `users`), `numbers` (`current_value`) AS (SELECT CAST(? AS SIGNED) AS `current_value` UNION ALL SELECT (`numbers`.`current_value` + ?) AS `current_value` FROM `numbers` WHERE (`numbers`.`current_value` < ?)) SELECT `numbers`.`current_value` AS `currentValue` FROM `numbers`',
    parameters: [1, 1, 3],
  })
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
