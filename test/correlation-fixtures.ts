import {
  correlate,
  crossJoin,
  desc,
  eq,
  fetchFirst,
  from,
  integer,
  lateral,
  leftJoin,
  orderBy,
  scalar,
  select,
  table,
  text,
  where,
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

export const outerProvision = correlate(users)

export const correlatedPost = select(
  { id: posts.id },
  from(posts),
  outerProvision,
  where(eq(posts.authorId, users.id)),
  orderBy(desc(posts.id)),
  fetchFirst(1)
)

export const correlatedScalar = scalar(correlatedPost)

export const correlatedQuery = select(
  {
    userId: users.id,
    latestPostId: correlatedScalar,
  },
  from(users),
  where(eq(users.id, 7))
)

export const lateralPost = lateral(correlatedPost, 'latest_post')

export const lateralQuery = select(
  {
    userId: users.id,
    latestPostId: lateralPost.id,
  },
  from(users),
  crossJoin(lateralPost),
  where(eq(users.id, 7))
)

export const leftLateralQuery = select(
  { latestPostId: lateralPost.id },
  from(users),
  leftJoin(lateralPost, eq(users.id, lateralPost.id))
)

export const localPostQuery = select({ id: posts.id }, from(posts))
export const localScalar = scalar(localPostQuery)
