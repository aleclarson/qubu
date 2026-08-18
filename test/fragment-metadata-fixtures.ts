import {
  caseWhen,
  coalesce,
  commaSeparated,
  count,
  countDistinct,
  eq,
  expressionFragment,
  from,
  groupBy,
  isNotNull,
  isNull,
  keyword,
  leftJoin,
  parenthesize,
  select,
  sequence,
  syntax,
  table,
  text,
  upper,
  value,
} from '../src/index.ts'

export const users = table('users', {
  id: text(),
  name: text(),
})

export const posts = table('posts', {
  id: text(),
  authorId: text(),
  title: text(),
})

export const sourceAwareSequence = sequence(
  [users.name, syntax('COLLATE "C"')],
  ' '
)

export const mixedSourceSequence = sequence([users.name, posts.title], ' ')

export const metadataFreeSequence = sequence([syntax('CURRENT_DATE')])

export const parenthesizedColumn = parenthesize(posts.title)
export const keywordColumn = keyword('COLLATE', posts.title)
export const commaSeparatedColumns = commaSeparated([users.id, posts.id])
export const expressionWrappedColumn = expressionFragment(posts.title)

export const upperPostTitle = upper(posts.title)
export const countedPostIds = count(posts.id)
export const distinctPostIds = countDistinct(posts.id)
const fallbackTitle: string = 'untitled'
const presentStatus: string = 'present'
const missingStatus: string = 'missing'

export const coalescedPostTitle = coalesce(posts.title, value(fallbackTitle))
export const literalCase = caseWhen(
  isNotNull(posts.title),
  presentStatus,
  missingStatus
)
export const nullPredicate = isNull(posts.title)
export const notNullPredicate = isNotNull(posts.title)

export const leftJoinClause = leftJoin(posts, eq(users.id, posts.authorId))

export const sequenceWithJoin = sequence(
  [users.name, leftJoinClause, syntax('/* reusable */')],
  ' '
)

export const leftJoinedQuery = select(
  {
    postTitle: posts.title,
    postTitleUpper: upper(posts.title),
    postCount: count(posts.id),
    postCountDistinct: countDistinct(posts.id),
    postIsMissing: nullPredicate,
    postIsPresent: notNullPredicate,
  },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  groupBy(users.name, posts.title)
)
