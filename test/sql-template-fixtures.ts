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

export const normalizedName = sql.type<string, SqlText>()`LOWER(${users.name})`

export const normalizedPostTitle = sql.type<string, SqlText>()`LOWER(${posts.title})`

export const aggregatePostCount = sql.type<number, SqlInteger>()`${count(posts.id)}`

export const windowedPostCount = sql.type<number, SqlInteger>()`${over(count(posts.id), {
  partitionBy: [users.id],
})}`

export const postgresPredicate = withDialectCapability(
  sql.type<boolean, SqlBoolean>()`${users.name} ILIKE ${"%ada%"}`,
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

export const correlatedQueryTemplate = sql.type<
  boolean,
  SqlBoolean
>()`EXISTS (${correlatedPostIds})`

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
