import {
  alias,
  count,
  correlate,
  cte,
  desc,
  eq,
  fetchFirst,
  from,
  groupBy,
  gt,
  having,
  integer,
  leftJoin,
  orderBy,
  over,
  rowNumber,
  scalar,
  select,
  sum,
  table,
  text,
  unionAll,
  where,
  withCte,
} from "qubu"
import type { OutputOf, RequiresOuterOf, SourceIdentity } from "qubu"

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition

export const users = table("users", {
  id: integer(),
  organizationId: integer(),
  name: text(),
  email: text({ nullable: true }),
})

export const posts = table("posts", {
  id: integer(),
  authorId: integer(),
  title: text(),
  views: integer(),
})

export const joinedUsersAndPosts = select(
  {
    userId: users.id,
    userName: users.name,
    postTitle: posts.title,
  },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  orderBy(users.name, desc(posts.id)),
)

export const groupedPostStats = select(
  {
    authorId: posts.authorId,
    postCount: count(posts.id),
    totalViews: sum(posts.views),
    rankByViews: over(rowNumber(), {
      orderBy: [desc(sum(posts.views))],
    }),
  },
  from(posts),
  groupBy(posts.authorId),
  having(gt(count(posts.id), 0)),
  orderBy(desc(sum(posts.views))),
)

export const correlatedLatestPost = select(
  { id: posts.id },
  from(posts),
  correlate(users),
  where(eq(posts.authorId, users.id)),
  orderBy(desc(posts.id)),
  fetchFirst(1),
)

export const correlatedLatestPostId = scalar(correlatedLatestPost)

export const usersWithLatestPost = select(
  {
    userId: users.id,
    latestPostId: correlatedLatestPostId,
  },
  from(users),
)

export const postStatsCte = cte("post_stats", groupedPostStats)

export const usersWithPostStats = select(
  {
    userId: users.id,
    userName: users.name,
    postCount: postStatsCte.postCount,
    totalViews: postStatsCte.totalViews,
  },
  withCte(postStatsCte),
  from(users),
  leftJoin(postStatsCte, eq(users.id, postStatsCte.authorId)),
)

export const aliasedPostStats = alias(groupedPostStats, "aliased_post_stats")

export const postAuthorIds = unionAll(
  select({ id: users.id }, from(users)),
  select({ id: posts.authorId }, from(posts)),
)

export type LeftJoinOutput = Assert<
  Equal<
    typeof joinedUsersAndPosts.row,
    {
      userId: number
      userName: string
      postTitle: string | null
    }
  >
>

export type GroupedAndWindowedOutput = Assert<
  Equal<
    typeof groupedPostStats.row,
    {
      authorId: number
      postCount: number
      totalViews: number
      rankByViews: number
    }
  >
>

export type CorrelatedScope = Assert<
  Equal<RequiresOuterOf<typeof correlatedLatestPost>, SourceIdentity<typeof users>>
>

export type CorrelatedOutput = Assert<
  Equal<
    typeof usersWithLatestPost.row,
    {
      userId: number
      latestPostId: number | null
    }
  >
>

export type CteAndLeftJoinOutput = Assert<
  Equal<
    typeof usersWithPostStats.row,
    {
      userId: number
      userName: string
      postCount: number | null
      totalViews: number | null
    }
  >
>

export type AliasOutput = Assert<
  Equal<
    OutputOf<typeof aliasedPostStats>,
    readonly {
      authorId: number
      postCount: number
      totalViews: number
      rankByViews: number
    }[]
  >
>

export type SetCompositionOutput = OutputOf<typeof postAuthorIds>
