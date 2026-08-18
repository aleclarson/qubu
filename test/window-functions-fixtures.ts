import {
  aliasExpression,
  count,
  desc,
  integer,
  over,
  rank,
  rowNumber,
  table,
  text,
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

export const partitionedRowNumber = over(rowNumber(), {
  partitionBy: [users.id],
  orderBy: [desc(users.name)],
})

export const mixedWindowCount = over(count(posts.id), {
  partitionBy: [users.id],
  orderBy: [desc(posts.title)],
})

export const nullableWindow = over(upper(posts.title), {
  partitionBy: [users.id],
})

export const aliasedRowNumber = aliasExpression(
  partitionedRowNumber,
  'rowNumber'
)

export const unconfiguredRank = over(rank())
