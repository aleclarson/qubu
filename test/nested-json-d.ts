import { expectTypeOf } from "vitest"

import {
  all,
  bigint,
  boolean,
  correlate,
  eq,
  fetchFirst,
  from,
  integer,
  insertInto,
  values,
  jsonArrayFrom,
  jsonObjectFrom,
  omit,
  select,
  table,
  text,
  timestamp,
  unionAll,
  value,
  where,
  type QueryRow,
} from "../src/index.ts"
const users = table("json_users", { id: integer(), name: text() })
const posts = table("json_posts", {
  id: bigint(),
  authorId: integer(),
  active: boolean(),
  createdAt: timestamp(),
})
const children = select(
  all(posts),
  from(posts),
  correlate(users),
  where(eq(posts.authorId, users.id)),
)
const query = select(
  {
    id: users.id,
    posts: jsonArrayFrom(children),
    latest: jsonObjectFrom(select(all(posts), from(posts), fetchFirst(1))),
  },
  from(users),
)
expectTypeOf<QueryRow<typeof query>>().toEqualTypeOf<{
  id: number
  posts: { id: bigint; authorId: number; active: boolean; createdAt: Date }[]
  latest: { id: bigint; authorId: number; active: boolean; createdAt: Date } | null
}>()
const nested = select({
  outer: jsonObjectFrom(select({ inner: jsonArrayFrom(select({ name: value("Ada") })) })),
})
expectTypeOf<QueryRow<typeof nested>>().toEqualTypeOf<{
  outer: { inner: { name: string }[] }
}>()
// @ts-expect-error unbounded object query has no cardinality proof
jsonObjectFrom(select(all(posts), from(posts)))
// @ts-expect-error correlated child requires its outer source
select({ children: jsonArrayFrom(children) })
// @ts-expect-error unrelated source does not satisfy the correlated requirement
select({ children: jsonArrayFrom(children) }, from(posts))
const conditional = true as boolean
// @ts-expect-error conditional pagination does not prove at-most-one
jsonObjectFrom(select(all(posts), from(posts), conditional ? fetchFirst(1) : omit))
// @ts-expect-error set cardinality is not proof of at-most-one
jsonObjectFrom(unionAll(select({ id: value(1) }), select({ id: value(2) })))
jsonObjectFrom(select(all(posts), from(posts), fetchFirst(0)))

// @ts-expect-error mutation queries cannot be embedded as nested JSON reads
jsonArrayFrom(insertInto(users, values({ id: 1, name: "Ada" })))
