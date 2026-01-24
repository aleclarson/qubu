import { count, exists, from, select, SQL, where } from 'qubu'
import { expect, test } from 'vitest'
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

test('Subquery with IN operator', () => {
  const user = users.as('u')

  const postAuthorIds = select(posts.authorId, from(posts))

  const query = select(
    user.id,
    from(user),
    where(user.id.is('in', [postAuthorIds]))
  )

  expect(toString(query)).toMatchInlineSnapshot(`
    [
      "select u.id from users as u where u.id in (select posts.author_id from posts)",
      [],
    ]
  `)
})

test('Subquery with EXISTS', () => {
  const user = users.as('u')

  const userPosts = select(
    posts.id,
    from(posts),
    where(posts.authorId.is('=', user.id))
  )

  const query = select(user.id, from(user), where(exists(userPosts)))

  expect(toString(query)).toMatchInlineSnapshot(`
    [
      "select u.id from users as u where exists (select posts.id from posts where posts.author_id = u.id)",
      [],
    ]
  `)
})

test('Basic subquery as table source with required alias', () => {
  const postAuthors = select(
    {
      authorId: posts.authorId,
    },
    from(posts)
  ).as('postAuthors')

  const query = select(postAuthors.authorId, from(postAuthors))

  expect(toString(query)).toMatchInlineSnapshot(`
    [
      "select "postAuthors"."authorId" from (select posts.author_id as "authorId" from posts) as "postAuthors"",
      [],
    ]
  `)
})
