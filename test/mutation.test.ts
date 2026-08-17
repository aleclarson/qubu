import { expect, expectTypeOf, test } from 'vitest'
import {
  all,
  allowAll,
  defaultValues,
  deleteFrom,
  eq,
  from,
  insertInto,
  insertSelect,
  integer,
  render,
  returning,
  select,
  table,
  text,
  update,
  upper,
  values,
  where,
} from '../src/index.ts'

const users = table('users', {
  id: integer({ generated: true }),
  name: text(),
  email: text({ nullable: true, hasDefault: true }),
})

test('renders typed multi-row INSERT values and RETURNING projections', () => {
  const query = insertInto(
    users,
    values(
      { name: 'Ada', email: null },
      { name: 'Grace', email: 'grace@example.com' }
    ),
    returning({ id: users.id, name: users.name })
  )

  expect(render(query)).toEqual({
    text: 'INSERT INTO "users" ("name", "email") VALUES (?, ?), (?, ?) RETURNING "users"."id" AS "id", "users"."name" AS "name"',
    parameters: ['Ada', null, 'Grace', 'grace@example.com'],
  })
  expectTypeOf(query.row).toEqualTypeOf<{ id: number; name: string }>()
})

test('renders DEFAULT VALUES when a table has only generated/default columns', () => {
  const audit = table('audit', {
    id: integer({ generated: true }),
    createdAt: text({ hasDefault: true }),
  })
  const query = insertInto(audit, defaultValues(), returning(all(audit)))

  expect(render(query).text).toBe(
    'INSERT INTO "audit" DEFAULT VALUES RETURNING "audit".*'
  )
})

test('composes INSERT ... SELECT with source parameters', () => {
  const archive = table('user_archive', { name: text() })
  const names = select(
    { name: users.name },
    from(users),
    where(eq(users.id, 9))
  )
  const query = insertInto(archive, insertSelect(names, ['name']))

  expect(render(query)).toEqual({
    text: 'INSERT INTO "user_archive" ("name") SELECT "users"."name" AS "name" FROM "users" WHERE ("users"."id" = ?)',
    parameters: [9],
  })
})

test('renders safe UPDATE and DELETE statements with typed RETURNING rows', () => {
  const changed = update(
    users,
    { name: 'Ada' },
    where(eq(users.id, 7)),
    returning({ id: users.id, name: users.name })
  )
  const removed = deleteFrom(
    users,
    where(eq(users.id, 8)),
    returning(all(users))
  )

  expect(render(changed)).toEqual({
    text: 'UPDATE "users" SET "name" = ? WHERE ("users"."id" = ?) RETURNING "users"."id" AS "id", "users"."name" AS "name"',
    parameters: ['Ada', 7],
  })
  expect(render(removed)).toEqual({
    text: 'DELETE FROM "users" WHERE ("users"."id" = ?) RETURNING "users".*',
    parameters: [8],
  })
  expectTypeOf(changed.row).toEqualTypeOf<{ id: number; name: string }>()
  expectTypeOf(removed.row).toEqualTypeOf<{
    id: number
    name: string
    email: string | null
  }>()
})

test('tracks target scope through UPDATE assignment expressions', () => {
  const query = update(
    users,
    { name: upper(users.name) },
    where(eq(users.id, 10))
  )

  expect(render(query)).toEqual({
    text: 'UPDATE "users" SET "name" = UPPER("users"."name") WHERE ("users"."id" = ?)',
    parameters: [10],
  })
})

test('requires an explicit unrestricted-mutation opt-in', () => {
  expect(() => {
    // @ts-expect-error UPDATE requires WHERE or allowAll().
    update(users, { name: 'Ada' })
  }).toThrowError(/requires a WHERE/)
  expect(() => {
    // @ts-expect-error DELETE requires WHERE or allowAll().
    deleteFrom(users)
  }).toThrowError(/requires a WHERE/)

  const unrestricted = update(users, { name: 'Ada' }, allowAll())
  expect(render(unrestricted).text).toBe('UPDATE "users" SET "name" = ?')
})
