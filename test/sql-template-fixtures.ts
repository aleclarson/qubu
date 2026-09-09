import { withDialectCapability } from "../src/core/index.ts"
import {
  count,
  correlate,
  eq,
  from,
  groupBy,
  integer,
  leftJoin,
  over,
  select,
  sql,
  table,
  text,
  where,
} from "../src/index.ts"
import type { SqlBoolean, SqlInteger, SqlText } from "../src/index.ts"

export const users = table("users", {
  id: integer(),
  name: text(),
})

export const posts = table("posts", {
  id: integer(),
  authorId: integer(),
  title: text(),
})

export const untypedTemplate = sql`CURRENT_TIMESTAMP`

export const normalizedName = sql`LOWER(${users.name})`.$type<string, SqlText>()

export const normalizedPostTitle = sql`LOWER(${posts.title})`.$type<string, SqlText>()

export const aggregatePostCount = sql`${count(posts.id)}`.$type<number, SqlInteger>()

export const windowedPostCount = sql`${over(count(posts.id), {
  partitionBy: [users.id],
})}`.$type<number, SqlInteger>()

export const postgresPredicate = withDialectCapability(
  sql`${users.name} ILIKE ${"%ada%"}`.$type<boolean, SqlBoolean>(),
  "ilike",
)

export const selectedUserIds = select({ userId: users.id }, from(users), groupBy(users.id))

export const queryTemplate = sql`EXISTS (${selectedUserIds})`

export const correlatedPostIds = select(
  { postId: posts.id },
  from(posts),
  correlate(users),
  where(eq(posts.authorId, users.id)),
)

export const correlatedQueryTemplate = sql`EXISTS (${correlatedPostIds})`.$type<
  boolean,
  SqlBoolean
>()

export const nestedTemplate = sql`${normalizedName}`

export const groupedTemplateQuery = select(
  {
    name: normalizedName,
    postCount: aggregatePostCount,
  },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  groupBy(normalizedName),
)

export const leftJoinedTemplateQuery = select(
  { title: normalizedPostTitle },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
)
