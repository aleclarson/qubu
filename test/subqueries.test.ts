import { expect, test } from 'vitest'
import { count, from, select, SQL, where } from 'yiss'
import { posts, users } from './common/schema.ts'

const { toString } = SQL.Query

test('Scalar subquery in SELECT list (single value)', () => {
  const u = users.as('u')

  const postCountSubquery = select(
    {
      totalPosts: count(),
    },
    from(posts),
    where(posts.authorId.is('=', u.id))
  )

  const query = select(u.id, postCountSubquery.as('postCount'), from(u))

  expect(toString(query)).toMatchInlineSnapshot(`
    [
      "select u.id, (select count(*) as "totalPosts" from posts where posts.author_id = u.id) as "postCount" from users as u",
      [],
    ]
  `)
})

test.skip('Subquery with IN operator', () => {})

test.skip('Subquery with EXISTS', () => {})

test.skip('Basic subquery as table source with required alias', () => {})
