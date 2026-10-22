import { expect, test } from "vitest"

import { standardDialect } from "../src/dialects/standard.ts"
import {
  alias,
  avg,
  count,
  eq,
  executeRows,
  from,
  fullJoin,
  max,
  min,
  render,
  rightJoin,
  select,
  sum,
  type QueryAdapter,
} from "../src/index.ts"
import { posts, users } from "./grouping-fixtures.ts"

test("renders FROM before composed outer joins in their relative order", () => {
  const later = alias(users, "later")
  const query = select(
    {
      name: users.name,
      title: posts.title,
      later: later.name,
    },
    fullJoin(posts, eq(users.id, posts.authorId)),
    from(users),
    rightJoin(later, eq(posts.authorId, later.id)),
  )

  expect(render(query)).toEqual({
    text: 'SELECT "users"."name" AS "name", "posts"."title" AS "title", "later"."name" AS "later" FROM "users" FULL JOIN "posts" ON ("users"."id" = "posts"."author_id") RIGHT JOIN "users" AS "later" ON ("posts"."author_id" = "later"."id")',
    parameters: [],
  })
})

test("preserves aggregate SQL domains and null results without converting wire values", async () => {
  const query = select(
    {
      total: sum(users.id),
      minimum: min(users.id),
      maximum: max(users.id),
      average: avg(users.id),
      rows: count(),
    },
    from(users),
  )
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute(request) {
      expect(request.resultShape).toEqual({
        fields: [
          {
            name: "total",
            sqlType: "integer",
          },
          {
            name: "minimum",
            sqlType: "integer",
          },
          {
            name: "maximum",
            sqlType: "integer",
          },
          {
            name: "average",
            sqlType: "decimal",
          },
          {
            name: "rows",
            sqlType: "integer",
          },
        ],
      })
      return {
        rows: [
          {
            total: null,
            minimum: null,
            maximum: null,
            average: null,
            rows: "0",
          },
        ],
      }
    },
  }

  await expect(executeRows(query, adapter)).resolves.toEqual([
    {
      total: null,
      minimum: null,
      maximum: null,
      average: null,
      rows: "0",
    },
  ])
})
