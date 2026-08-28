import { expect, test } from "vitest"

import {
  count,
  desc,
  eq,
  fetchFirst,
  from,
  groupBy,
  gt,
  having,
  leftJoin,
  orderBy,
  render,
  select,
  value,
} from "../src/index.ts"
import { posts, users } from "./grouping-fixtures.ts"

test("renders grouped projections and HAVING in SQL clause order", () => {
  const query = select(
    {
      name: users.name,
      postCount: count(posts.id),
    },
    from(users),
    leftJoin(posts, eq(users.id, posts.authorId)),
    groupBy(users.name),
    having(gt(count(posts.id), 0)),
    orderBy(users.name),
  )

  expect(render(query)).toEqual({
    text: 'SELECT "users"."name" AS "name", COUNT("posts"."id") AS "postCount" FROM "users" LEFT JOIN "posts" ON ("users"."id" = "posts"."author_id") GROUP BY "users"."name" HAVING (COUNT("posts"."id") > ?) ORDER BY "users"."name"',
    parameters: [0],
  })
})

test("preserves parameter order through grouped clauses", () => {
  const query = select(
    {
      name: users.name,
      postCount: count(posts.id),
    },
    orderBy(desc(value("name"))),
    having(gt(count(posts.id), value(1))),
    fetchFirst(5),
    groupBy(users.name),
    leftJoin(posts, eq(users.id, posts.authorId)),
    from(users),
  )

  expect(render(query)).toEqual({
    text: 'SELECT "users"."name" AS "name", COUNT("posts"."id") AS "postCount" FROM "users" LEFT JOIN "posts" ON ("users"."id" = "posts"."author_id") GROUP BY "users"."name" HAVING (COUNT("posts"."id") > ?) ORDER BY ? DESC FETCH FIRST ? ROWS ONLY',
    parameters: [1, "name", 5],
  })
})
