import { expect, expectTypeOf, test } from 'vitest'
import {
  alias,
  aliasExpression,
  all,
  asc,
  count,
  desc,
  distinct,
  eq,
  fetchFirst,
  from,
  groupBy,
  innerJoin,
  integer,
  isNotNull,
  orderBy,
  postgresDialect,
  render,
  select,
  table,
  text,
  value,
  where,
} from '../src/index.ts'

const users = table('users', {
  id: integer(),
  name: text(),
  email: text({ nullable: true }),
})

const posts = table('posts', {
  id: integer(),
  authorId: integer(),
  title: text(),
})

test('renders a parameterized standard SQL select', () => {
  const query = select(
    {
      id: users.id,
      displayName: users.name,
    },
    from(users),
    where(eq(users.id, 7)),
    orderBy(desc(users.name)),
    fetchFirst(10)
  )

  expect(render(query)).toEqual({
    text: 'SELECT "users"."id" AS "id", "users"."name" AS "displayName" FROM "users" WHERE ("users"."id" = ?) ORDER BY "users"."name" DESC FETCH FIRST ? ROWS ONLY',
    parameters: [7, 10],
  })
})

test('renders aliases, joins, grouping, and distinct', () => {
  const author = alias(users, 'author')
  const query = select(
    [author.name, aliasExpression(count(posts.id), 'postCount')],
    from(author),
    innerJoin(posts, eq(author.id, posts.authorId)),
    where(isNotNull(author.email)),
    groupBy(author.name),
    orderBy(asc(author.name)),
    distinct()
  )

  expect(render(query).text).toBe(
    'SELECT DISTINCT "author"."name", COUNT("posts"."id") AS "postCount" FROM "users" AS "author" INNER JOIN "posts" ON ("author"."id" = "posts"."authorId") WHERE ("author"."email" IS NOT NULL) GROUP BY "author"."name" ORDER BY "author"."name" ASC'
  )
})

test('renders wildcard projections and PostgreSQL placeholders through a dialect', () => {
  const query = select(all(users), from(users), where(eq(users.id, value(3))))

  expect(render(query, postgresDialect())).toEqual({
    text: 'SELECT "users".* FROM "users" WHERE ("users"."id" = $1)',
    parameters: [3],
  })
})

test('tracks source requirements in the select type', () => {
  // @ts-expect-error A table-backed column needs its source in FROM or JOIN.
  select({ id: users.id })
})

test('preserves selected row types', () => {
  const query = select(
    {
      id: users.id,
      email: users.email,
    },
    from(users)
  )

  expectTypeOf(query.row).toEqualTypeOf<{
    id: number
    email: string | null
  }>()
})
