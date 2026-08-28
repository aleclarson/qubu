import { expect, expectTypeOf, test } from "vitest"

import {
  alias,
  all,
  cte,
  eq,
  from,
  insertInto,
  integer,
  render,
  returning,
  scalar,
  select,
  table,
  text,
  update,
  values,
  where,
  withCte,
} from "../src/index.ts"

const accounts = table("accounts", {
  userID: integer(),
  APIKey: text(),
  createdAt: text({ sqlName: "creation_timestamp" }),
})

test("maps camel case and acronym field names to SQL column names", () => {
  const query = select(all(accounts), from(accounts))

  expect(render(query).text).toBe(
    'SELECT "accounts"."user_id" AS "userID", "accounts"."api_key" AS "APIKey", "accounts"."creation_timestamp" AS "createdAt" FROM "accounts"',
  )
  expect(accounts.userID.fieldName).toBe("userID")
  expect(accounts.userID.columnName).toBe("user_id")
  expectTypeOf(query.row).toEqualTypeOf<{
    userID: number
    APIKey: string
    createdAt: string
  }>()
})

test("uses snake case names inside relational projections", () => {
  const projected = cte(
    "projected_accounts",
    select(
      {
        ownerID: accounts.userID,
        credentialKey: accounts.APIKey,
      },
      from(accounts),
    ),
  )
  const query = select(
    {
      ownerID: projected.ownerID,
      credentialKey: projected.credentialKey,
    },
    withCte(projected),
    from(projected),
  )

  expect(render(query).text).toBe(
    'WITH "projected_accounts" AS (SELECT "accounts"."user_id" AS "owner_id", "accounts"."api_key" AS "credential_key" FROM "accounts") SELECT "projected_accounts"."owner_id" AS "ownerID", "projected_accounts"."credential_key" AS "credentialKey" FROM "projected_accounts"',
  )
})

test("uses relational names for derived tables and scalar subqueries", () => {
  const owners = select({ ownerID: accounts.userID }, from(accounts))
  const ownerSource = alias(owners, "owners")
  const query = select(
    {
      ownerID: ownerSource.ownerID,
      firstOwnerID: scalar(owners),
    },
    from(ownerSource),
  )

  expect(render(query).text).toBe(
    'SELECT "owners"."owner_id" AS "ownerID", (SELECT "accounts"."user_id" AS "owner_id" FROM "accounts") AS "firstOwnerID" FROM (SELECT "accounts"."user_id" AS "owner_id" FROM "accounts") AS "owners"',
  )
})

test("maps application field names in mutations", () => {
  const inserted = insertInto(
    accounts,
    values({
      userID: 7,
      APIKey: "secret",
      createdAt: "now",
    }),
    returning({ createdAt: accounts.createdAt }),
  )
  const changed = update(accounts, { createdAt: "later" }, where(eq(accounts.userID, 7)))

  expect(render(inserted)).toEqual({
    text: 'INSERT INTO "accounts" ("user_id", "api_key", "creation_timestamp") VALUES (?, ?, ?) RETURNING "accounts"."creation_timestamp" AS "createdAt"',
    parameters: [7, "secret", "now"],
  })
  expect(render(changed)).toEqual({
    text: 'UPDATE "accounts" SET "creation_timestamp" = ? WHERE ("accounts"."user_id" = ?)',
    parameters: ["later", 7],
  })
})

test("rejects SQL name collisions after normalization", () => {
  expect(() =>
    table("ambiguous", {
      userId: integer(),
      userID: integer(),
    }),
  ).toThrowError('Fields "userId" and "userID" both resolve to SQL name "user_id"')
})

test("rejects SQL name collisions in derived relations", () => {
  const ambiguous = select(
    {
      userId: accounts.userID,
      userID: accounts.userID,
    },
    from(accounts),
  )

  expect(() => cte("ambiguous", ambiguous)).toThrowError(
    'Fields "userId" and "userID" both resolve to SQL name "user_id"',
  )
})
