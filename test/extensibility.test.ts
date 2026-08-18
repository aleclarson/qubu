import { expect, expectTypeOf, test } from 'vitest'
import {
  aliasExpression,
  createDialect,
  customClause,
  fetchFirst,
  from,
  ilike,
  like,
  makeExpression,
  mysqlDialect,
  offset,
  postgresDialect,
  render,
  select,
  sequence,
  sqliteDialect,
  syntax,
  table,
  text,
  unsafeExpression,
  where,
} from '../src/index.ts'
import type {
  RequiresOf,
  RequiresSourceMeta,
  ResultMeta,
  SourceIdentity,
} from '../src/index.ts'

const users = table('users', { name: text() })

test('preserves source metadata through sequence without call-site assertions', () => {
  const composed = sequence([users.name, syntax('COLLATE "C"')], ' ')

  expectTypeOf<RequiresOf<typeof composed>>().toEqualTypeOf<
    SourceIdentity<typeof users>
  >()
  expect(render(composed).text).toBe('"users"."name" COLLATE "C"')
})

test('accepts a dialect without changing query construction', () => {
  const dialect = createDialect({
    name: 'bracketed',
    quoteIdentifier: name => `[${name}]`,
    placeholder: position => `:p${position}`,
  })
  const query = select(
    {
      name: users.name,
      current: aliasExpression(unsafeExpression('CURRENT_DATE'), 'current'),
    },
    from(users)
  )

  expect(render(query, dialect)).toEqual({
    text: 'SELECT [users].[name] AS [name], CURRENT_DATE AS [current] FROM [users]',
    parameters: [],
  })
})

test('composes custom fragments and clauses', () => {
  const customExpression = makeExpression<ResultMeta<number>, 'function'>(
    'function',
    context => context.append('42')
  )
  const custom = customClause({
    name: 'sample',
    order: 90,
    render: context => context.append('FETCH FIRST 1 ROW ONLY'),
  })
  const query = select(
    { answer: aliasExpression(customExpression, 'answer') },
    from(users),
    custom
  )

  expect(render(query).text).toBe(
    'SELECT 42 AS "answer" FROM "users" FETCH FIRST 1 ROW ONLY'
  )
})

test('renders dialect-specific pagination and expressions at the boundary', () => {
  const postgresQuery = select(
    { name: users.name },
    from(users),
    where(ilike(users.name, '%ada%'))
  )
  const paginationQuery = select(
    { name: users.name },
    from(users),
    offset(5),
    fetchFirst(10)
  )

  expect(render(postgresQuery, postgresDialect())).toEqual({
    text: 'SELECT "users"."name" AS "name" FROM "users" WHERE ("users"."name" ILIKE $1)',
    parameters: ['%ada%'],
  })
  expect(render(paginationQuery, postgresDialect())).toEqual({
    text: 'SELECT "users"."name" AS "name" FROM "users" LIMIT $1 OFFSET $2',
    parameters: [10, 5],
  })
  expect(render(paginationQuery, sqliteDialect())).toEqual({
    text: 'SELECT "users"."name" AS "name" FROM "users" LIMIT ? OFFSET ?',
    parameters: [10, 5],
  })
  expect(render(paginationQuery, mysqlDialect())).toEqual({
    text: 'SELECT `users`.`name` AS `name` FROM `users` LIMIT ? OFFSET ?',
    parameters: [10, 5],
  })
})

test('keeps custom clauses typed, placed, parameterized, and source-aware', () => {
  const custom = customClause<RequiresSourceMeta<SourceIdentity<typeof users>>>(
    {
      name: 'as-of',
      placement: 'before-select',
      order: 5,
      render(context) {
        context.append('/* AS OF ')
        context.parameter("O'Reilly")
        context.append(' */')
      },
    }
  )
  const dialect = createDialect({
    name: 'named',
    placeholder: position => `:p${position}`,
  })
  const query = select(
    { name: users.name },
    custom,
    from(users),
    where(like(users.name, "O'Reilly"))
  )

  expect(render(query, dialect)).toEqual({
    text: '/* AS OF :p1 */ SELECT "users"."name" AS "name" FROM "users" WHERE ("users"."name" LIKE :p2)',
    parameters: ["O'Reilly", "O'Reilly"],
  })

  const posts = table('posts', { name: text() })
  const missingSource = customClause<
    RequiresSourceMeta<SourceIdentity<typeof users>>
  >({
    name: 'requires-users',
    order: 5,
    render: context => context.append('/* users */'),
  })
  // @ts-expect-error Custom clauses participate in source-scope validation.
  select({ name: posts.name }, from(posts), missingSource)
})
