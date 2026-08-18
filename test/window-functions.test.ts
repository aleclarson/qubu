import { expect, expectTypeOf, test } from 'vitest'
import {
  aliasExpression,
  count,
  desc,
  eq,
  fetchFirst,
  from,
  integer,
  leftJoin,
  orderBy,
  over,
  render,
  rowNumber,
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
})

const posts = table('posts', {
  id: integer(),
  authorId: integer(),
  title: text(),
})

test('renders window partitioning and ordering in projections and order clauses', () => {
  const ranked = over(rowNumber(), {
    partitionBy: [users.id],
    orderBy: [desc(users.name)],
  })
  const query = select(
    {
      id: users.id,
      rowNumber: aliasExpression(ranked, 'rowNumber'),
    },
    from(users),
    orderBy(ranked)
  )

  expect(render(query).text).toBe(
    'SELECT "users"."id" AS "id", ROW_NUMBER() OVER (PARTITION BY "users"."id" ORDER BY "users"."name" DESC) AS "rowNumber" FROM "users" ORDER BY ROW_NUMBER() OVER (PARTITION BY "users"."id" ORDER BY "users"."name" DESC)'
  )
  expectTypeOf(query.row).toEqualTypeOf<{
    id: number
    rowNumber: number
  }>()
})

test('preserves parameter order through window expressions and clauses', () => {
  const runningCount = over(count(users.id), {
    orderBy: [desc(value(3))],
  })
  const query = select(
    { count: aliasExpression(runningCount, 'count') },
    from(users),
    fetchFirst(10),
    where(eq(users.id, 7))
  )

  expect(render(query)).toEqual({
    text: 'SELECT COUNT("users"."id") OVER (ORDER BY ? DESC) AS "count" FROM "users" WHERE ("users"."id" = ?) FETCH FIRST ? ROWS ONLY',
    parameters: [3, 7, 10],
  })
})

test('preserves nullable output through window composition', () => {
  const query = select(
    {
      title: aliasExpression(
        over(upper(posts.title), { partitionBy: [users.id] }),
        'title'
      ),
    },
    from(users),
    leftJoin(posts, eq(users.id, posts.authorId))
  )

  expectTypeOf(query.row).toEqualTypeOf<{ title: string | null }>()
})

test('checks window specification sources', () => {
  const valid = select(
    {
      rowNumber: aliasExpression(
        over(rowNumber(), { partitionBy: [users.id] }),
        'rowNumber'
      ),
    },
    from(users)
  )

  select(
    {
      rowNumber: aliasExpression(
        over(rowNumber(), { partitionBy: [users.id] }),
        'rowNumber'
      ),
    },
    // @ts-expect-error A window partition expression needs its source in scope.
    from(posts)
  )

  expect(render(valid).text).toContain(
    'ROW_NUMBER() OVER (PARTITION BY "users"."id")'
  )
})
