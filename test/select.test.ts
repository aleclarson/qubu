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
  having,
  innerJoin,
  inList,
  integer,
  isDistinctFrom,
  isNotNull,
  lt,
  ne,
  notIn,
  orderBy,
  offset,
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

const comments = table('comments', {
  id: integer(),
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

test('normalizes clause order and follows rendered parameter order', () => {
  const query = select(
    { id: users.id },
    fetchFirst(10),
    orderBy(desc(users.name)),
    offset(5),
    where(eq(users.id, 7)),
    from(users)
  )

  expect(render(query)).toEqual({
    text: 'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = ?) ORDER BY "users"."name" DESC OFFSET ? ROWS FETCH FIRST ? ROWS ONLY',
    parameters: [7, 5, 10],
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

test('reports missing sources across every source-aware SELECT clause', () => {
  // @ts-expect-error The selected column is absent from the query scope.
  select({ id: users.id }, from(posts))
  select(
    { id: posts.id },
    // @ts-expect-error The join predicate references an absent source.
    from(posts),
    innerJoin(users, eq(users.id, comments.id))
  )
  // @ts-expect-error WHERE references users, which is not in scope.
  select({ id: posts.id }, from(posts), where(eq(users.id, 1)))
  // @ts-expect-error GROUP BY references users, which is not in scope.
  select({ id: posts.id }, from(posts), groupBy(users.name))
  // @ts-expect-error HAVING references users, which is not in scope.
  select({ id: posts.id }, from(posts), having(eq(users.id, 1)))
  // @ts-expect-error ORDER BY references users, which is not in scope.
  select({ id: posts.id }, from(posts), orderBy(users.name))

  const valid = select(
    { id: users.id, title: posts.title },
    from(users),
    innerJoin(posts, eq(users.id, posts.authorId))
  )
  expect(render(valid).text).toContain('INNER JOIN')
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

test('renders empty collection predicates with portable boolean semantics', () => {
  const query = select(
    { id: users.id },
    from(users),
    where(inList(users.id, []))
  )
  const excluded = select(
    { id: users.id },
    from(users),
    where(notIn(users.id, []))
  )

  expect(render(query).text).toBe(
    'SELECT "users"."id" AS "id" FROM "users" WHERE (1 = 0)'
  )
  expect(render(excluded).text).toBe(
    'SELECT "users"."id" AS "id" FROM "users" WHERE (1 = 1)'
  )
})

test('translates NULL equality safely and preserves distinctness semantics', () => {
  const isMissing = select(
    { id: users.id },
    from(users),
    where(eq(users.email, null))
  )
  const isPresent = select(
    { id: users.id },
    from(users),
    where(ne(users.email, value(null)))
  )
  const distinct = select(
    { id: users.id },
    from(users),
    where(isDistinctFrom(users.email, null))
  )

  expect(render(isMissing)).toEqual({
    text: 'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."email" IS NULL)',
    parameters: [],
  })
  expect(render(isPresent)).toEqual({
    text: 'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."email" IS NOT NULL)',
    parameters: [],
  })
  expect(render(distinct)).toEqual({
    text: 'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."email" IS DISTINCT FROM ?)',
    parameters: [null],
  })
  expect(() => {
    // @ts-expect-error Relational comparisons reject NULL at the type boundary.
    lt(users.id, null)
  }).toThrowError(TypeError)
})
