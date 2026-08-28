import { expect, test } from "vitest"

import { render } from "../src/index.ts"
import { correlatedQuery, lateralQuery } from "./correlation-fixtures.ts"

test("renders correlated scalar subqueries with outer references and parameters", () => {
  expect(render(correlatedQuery)).toEqual({
    text: 'SELECT "users"."id" AS "userId", (SELECT "posts"."id" AS "id" FROM "posts" WHERE ("posts"."author_id" = "users"."id") ORDER BY "posts"."id" DESC FETCH FIRST ? ROWS ONLY) AS "latestPostId" FROM "users" WHERE ("users"."id" = ?)',
    parameters: [1, 7],
  })
})

test("renders LATERAL sources without leaking local source scope", () => {
  expect(render(lateralQuery)).toEqual({
    text: 'SELECT "users"."id" AS "userId", "latest_post"."id" AS "latestPostId" FROM "users" CROSS JOIN LATERAL (SELECT "posts"."id" AS "id" FROM "posts" WHERE ("posts"."author_id" = "users"."id") ORDER BY "posts"."id" DESC FETCH FIRST ? ROWS ONLY) AS "latest_post" WHERE ("users"."id" = ?)',
    parameters: [1, 7],
  })
})
