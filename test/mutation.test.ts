import { expect, expectTypeOf, test } from 'vitest'
import {
  all,
  allowAll,
  defaultValues,
  deleteFrom,
  eq,
  from,
  gt,
  insertInto,
  insertSelect,
  integer,
  omit,
  render,
  returning,
  select,
  table,
  text,
  update,
  upper,
  unique,
  values,
  where,
} from '../src/index.ts'
import {
  doNothing,
  doUpdate,
  excluded,
  onConflict,
  postgresDialect,
} from '../src/dialects/postgres.ts'
import { sqliteDialect } from '../src/dialects/sqlite.ts'

const users = table('users', {
  id: integer({ generated: true }),
  name: text(),
  email: text({ nullable: true, hasDefault: true }),
})

const accounts = table(
  'accounts',
  {
    id: integer({ generated: true }),
    email: text(),
    name: text(),
    version: integer(),
  },
  accounts => ({
    constraints: {
      emailKey: unique(accounts.email),
    },
    indexes: {},
  })
)

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

test('renders PostgreSQL ON CONFLICT DO UPDATE with excluded values and a condition', () => {
  const incoming = excluded(accounts)
  const query = insertInto(
    accounts,
    values({ email: 'ada@example.com', name: 'Ada', version: 2 }),
    onConflict(
      accounts,
      accounts.constraints.emailKey,
      doUpdate(
        { name: incoming.name },
        where(gt(incoming.version, accounts.version))
      )
    ),
    returning({ id: accounts.id, name: accounts.name })
  )

  expect(render(query, postgresDialect())).toEqual({
    text: 'INSERT INTO "accounts" ("email", "name", "version") VALUES ($1, $2, $3) ON CONFLICT ("email") DO UPDATE SET "name" = excluded."name" WHERE (excluded."version" > "accounts"."version") RETURNING "accounts"."id" AS "id", "accounts"."name" AS "name"',
    parameters: ['ada@example.com', 'Ada', 2],
  })
})

test('renders SQLite ON CONFLICT DO NOTHING without a target', () => {
  const query = insertInto(
    accounts,
    values({ email: 'ada@example.com', name: 'Ada', version: 1 }),
    onConflict(doNothing())
  )

  expect(render(query, sqliteDialect())).toEqual({
    text: 'INSERT INTO "accounts" ("email", "name", "version") VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
    parameters: ['ada@example.com', 'Ada', 1],
  })
})

test('renders DEFAULT VALUES when a table has only generated/default columns', () => {
  const audit = table('audit', {
    id: integer({ generated: true }),
    createdAt: text({ hasDefault: true }),
  })
  const query = insertInto(audit, defaultValues(), returning(all(audit)))

  expect(render(query).text).toBe(
    'INSERT INTO "audit" DEFAULT VALUES RETURNING "audit"."id" AS "id", "audit"."created_at" AS "createdAt"'
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
    text: 'DELETE FROM "users" WHERE ("users"."id" = ?) RETURNING "users"."id" AS "id", "users"."name" AS "name", "users"."email" AS "email"',
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

test('omits conditional UPDATE assignments while preserving SQL values', () => {
  const conditionalUpdate = (
    includeName: boolean,
    email: string | null | undefined,
    id: number
  ) =>
    update(
      users,
      { name: includeName ? upper(users.name) : omit, email },
      where(eq(users.id, id))
    )

  const enabled = conditionalUpdate(true, null, 11)
  const disabled = conditionalUpdate(false, undefined, 12)

  expect(render(enabled)).toEqual({
    text: 'UPDATE "users" SET "name" = UPPER("users"."name"), "email" = ? WHERE ("users"."id" = ?)',
    parameters: [null, 11],
  })
  expect(render(disabled)).toEqual({
    text: 'UPDATE "users" SET "email" = ? WHERE ("users"."id" = ?)',
    parameters: [undefined, 12],
  })
})

test('rejects an UPDATE whose assignments are all omitted', () => {
  expect(() => update(users, { name: omit }, allowAll())).toThrowError(
    'UPDATE requires at least one assignment'
  )
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
