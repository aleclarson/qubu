import {
  aliasExpression,
  count,
  eq,
  from,
  groupBy,
  gt,
  having,
  integer,
  leftJoin,
  orderBy,
  over,
  rowNumber,
  select,
  table,
  text,
  sum,
  upper,
} from '../src/index.ts'

export const users = table('users', {
  id: integer(),
  name: text(),
})

export const posts = table('posts', {
  id: integer(),
  authorId: integer(),
  title: text(),
})

export const groupedName = upper(users.name)

export const groupedByColumnClause = groupBy(users.name)
export const groupedPostTotal = sum(posts.id)

export const groupedByColumn = select(
  {
    name: users.name,
    displayName: aliasExpression(upper(users.name), 'displayName'),
    postCount: aliasExpression(count(posts.id), 'postCount'),
    postTotal: aliasExpression(groupedPostTotal, 'postTotal'),
  },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  groupedByColumnClause,
  having(gt(count(posts.id), 0)),
  orderBy(users.name)
)

export const groupedByExpression = select(
  { displayName: groupedName },
  from(users),
  groupBy(groupedName)
)

export const groupedWithWindow = select(
  {
    name: users.name,
    rowNumber: aliasExpression(
      over(rowNumber(), { partitionBy: [users.name] }),
      'rowNumber'
    ),
    totalPosts: aliasExpression(over(count(posts.id)), 'totalPosts'),
  },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  groupBy(users.name)
)
