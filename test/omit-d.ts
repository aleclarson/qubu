import {
  distinct,
  eq,
  fetchFirst,
  from,
  groupBy,
  innerJoin,
  integer,
  omit,
  orderBy,
  select,
  table,
  where,
} from '../src/index.ts'

const users = table('users', { id: integer() })
const posts = table('posts', { id: integer(), authorId: integer() })
declare const enabled: boolean
declare const userId: number | undefined

select(
  { id: users.id },
  from(users),
  enabled ? where(eq(users.id, 1)) : omit,
  enabled ? orderBy(users.id) : omit,
  enabled ? distinct() : omit
)

select({ id: users.id }, from(users), omit)

select(
  { id: users.id },
  from(users),
  userId === undefined ? omit : where(eq(users.id, userId))
)

select(
  { id: users.id },
  // @ts-expect-error A conditional join cannot make its source available safely.
  from(users),
  enabled ? innerJoin(posts, eq(users.id, posts.authorId)) : omit
)

select(
  { id: users.id },
  // @ts-expect-error Conditional pagination cannot prove query cardinality.
  from(users),
  enabled ? fetchFirst(1) : omit
)

select(
  { id: users.id },
  // @ts-expect-error Conditional grouping changes query validity guarantees.
  from(users),
  enabled ? groupBy(users.id) : omit
)

select(
  { id: posts.id },
  // @ts-expect-error A conditional WHERE still retains its source requirements.
  from(posts),
  enabled ? where(eq(users.id, 1)) : omit
)
