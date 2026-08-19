import { expect, expectTypeOf, test } from 'vitest'
import {
  alias,
  all,
  and,
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
  leftJoin,
  lt,
  ne,
  notIn,
  omit,
  orderBy,
  offset,
  or,
  postgresDialect,
  render,
  select,
  table,
  text,
  upper,
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

test('omits conditional select clauses before validation and rendering', () => {
  const includeFilter = false as boolean
  const includeOrder = true as boolean
  const query = select(
    { id: users.id },
    from(users),
    includeFilter ? where(eq(users.id, 7)) : omit,
    includeOrder ? orderBy(desc(users.id)) : omit,
    where(eq(users.id, 3))
  )

  expect(render(query)).toEqual({
    text: 'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = ?) ORDER BY "users"."id" DESC',
    parameters: [3],
  })
})

test('composes omitted predicates and ordering terms', () => {
  const includeId = false as boolean
  const includeName = true as boolean
  const includeEmailOrder = false as boolean
  const query = select(
    { id: users.id },
    from(users),
    where(
      and(
        includeId ? eq(users.id, 7) : omit,
        or(omit, includeName ? eq(users.name, 'Ada') : omit)
      )
    ),
    orderBy(
      includeEmailOrder ? users.email : omit,
      includeName ? desc(users.name) : omit
    )
  )

  expect(render(query)).toEqual({
    text: 'SELECT "users"."id" AS "id" FROM "users" WHERE ((("users"."name" = ?))) ORDER BY "users"."name" DESC',
    parameters: ['Ada'],
  })
})

test('propagates fully omitted predicate and ordering compositions', () => {
  const query = select(
    { id: users.id },
    from(users),
    where(and(omit, or(omit))),
    having(or(omit)),
    orderBy(omit)
  )

  expect(render(query)).toEqual({
    text: 'SELECT "users"."id" AS "id" FROM "users"',
    parameters: [],
  })
})

test('models omitted projection fields as optional without changing nullability', () => {
  const includeName = false as boolean
  const includeEmail = true as boolean
  const query = select(
    {
      id: users.id,
      name: includeName ? users.name : omit,
      email: includeEmail ? users.email : omit,
    },
    from(users)
  )

  expect(render(query)).toEqual({
    text: 'SELECT "users"."id" AS "id", "users"."email" AS "email" FROM "users"',
    parameters: [],
  })
  expect(Object.keys(query.row)).toEqual(['id', 'email'])
  expectTypeOf(query.row).toEqualTypeOf<{
    id: number
    name?: string
    email?: string | null
  }>()

  expect(() => render(select({ name: omit }))).toThrowError(
    'select() requires at least one field'
  )
})

test('renders aliases, joins, grouping, and distinct', () => {
  const author = alias(users, 'author')
  const query = select(
    {
      name: author.name,
      postCount: count(posts.id),
    },
    from(author),
    innerJoin(posts, eq(author.id, posts.authorId)),
    where(isNotNull(author.email)),
    groupBy(author.name),
    orderBy(asc(author.name)),
    distinct()
  )

  expect(render(query).text).toBe(
    'SELECT DISTINCT "author"."name" AS "name", COUNT("posts"."id") AS "postCount" FROM "users" AS "author" INNER JOIN "posts" ON ("author"."id" = "posts"."author_id") WHERE ("author"."email" IS NOT NULL) GROUP BY "author"."name" ORDER BY "author"."name" ASC'
  )
})

test('expands all source columns into named object projections', () => {
  const query = select(
    { ...all(users), normalizedName: upper(users.name) },
    from(users),
    where(eq(users.id, value(3)))
  )

  expect(render(query, postgresDialect())).toEqual({
    text: 'SELECT "users"."id" AS "id", "users"."name" AS "name", "users"."email" AS "email", UPPER("users"."name") AS "normalizedName" FROM "users" WHERE ("users"."id" = $1)',
    parameters: [3],
  })
  expectTypeOf(query.row).toEqualTypeOf<{
    id: number
    name: string
    email: string | null
    normalizedName: string
  }>()
})

test('tracks source requirements in the select type', () => {
  // @ts-expect-error A table-backed column needs its source in FROM or JOIN.
  select({ id: users.id })

  expect(() => {
    // @ts-expect-error Projections must be named objects rather than positional arrays.
    select([users.id], from(users))
  }).toThrowError('Selection must be a named object projection')
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

test('marks left-joined results nullable without changing inner joins', () => {
  const leftJoined = select(
    {
      userName: users.name,
      postTitle: posts.title,
      postTitleUpper: upper(posts.title),
      postCount: count(posts.id),
    },
    from(users),
    leftJoin(posts, eq(users.id, posts.authorId)),
    groupBy(users.name, posts.title)
  )
  const innerJoined = select(
    { title: posts.title },
    from(users),
    innerJoin(posts, eq(users.id, posts.authorId))
  )
  const allPosts = select(
    all(posts),
    from(users),
    leftJoin(posts, eq(users.id, posts.authorId))
  )

  expectTypeOf(leftJoined.row).toEqualTypeOf<{
    userName: string
    postTitle: string | null
    postTitleUpper: string | null
    postCount: number
  }>()
  expectTypeOf(innerJoined.row).toEqualTypeOf<{ title: string }>()
  expectTypeOf(allPosts.row).toEqualTypeOf<{
    id: number | null
    authorId: number | null
    title: string | null
  }>()
})

test('keeps count without a source scope-free', () => {
  const query = select({ total: count() })

  expect(render(query).text).toBe('SELECT COUNT(*) AS "total"')
  expectTypeOf(query.row).toEqualTypeOf<{ total: number }>()
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
