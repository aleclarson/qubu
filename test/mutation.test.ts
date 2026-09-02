import { expect, expectTypeOf, test } from "vitest"

import {
  doNothing,
  doUpdate,
  excluded,
  onConflict,
  postgresDialect,
  updateFrom,
} from "../src/dialects/postgres.ts"
import { sqliteDialect, sqliteTimestamp } from "../src/dialects/sqlite.ts"
import {
  all,
  add,
  allowAll,
  asc,
  boolean,
  cast,
  column,
  cte,
  defaultValues,
  deleteFrom,
  eq,
  from,
  gt,
  inQuery,
  insertInto,
  insertSelect,
  index,
  integer,
  lt,
  omit,
  nativeStorage,
  QueryValidationError,
  render,
  returning,
  recursiveCte,
  select,
  table,
  text,
  update,
  upper,
  unique,
  value,
  values,
  where,
  withCte,
} from "../src/index.ts"

const users = table("users", {
  id: integer({ generated: true }),
  name: text(),
  email: text({
    nullable: true,
    hasDefault: true,
  }),
})

const accounts = table(
  "accounts",
  {
    id: integer({ generated: true }),
    email: text(),
    name: text(),
    version: integer(),
  },
  (accounts) => ({
    constraints: {
      emailKey: unique(accounts.email),
    },
    indexes: {},
  }),
)

const indexedAccounts = table(
  "indexed_accounts",
  {
    id: integer({ generated: true }),
    email: text(),
    active: boolean(),
    name: text(),
  },
  (accounts) => ({
    constraints: {},
    indexes: {
      emailIndex: index([accounts.email], { unique: true }),
      activeEmailIndex: index([asc(accounts.email, "LAST")], {
        unique: true,
        where: eq(accounts.active, value(true)),
        dialect: { dialect: "postgresql" },
      }),
      nameLookup: index([accounts.name]),
    },
  }),
)

test("renders typed multi-row INSERT values and RETURNING projections", () => {
  const query = insertInto(
    users,
    values(
      {
        name: "Ada",
        email: null,
      },
      {
        name: "Grace",
        email: "grace@example.com",
      },
    ),
    returning({
      id: users.id,
      name: users.name,
    }),
  )

  expect(render(query)).toEqual({
    text: 'INSERT INTO "users" ("name", "email") VALUES (?, ?), (?, ?) RETURNING "users"."id" AS "id", "users"."name" AS "name"',
    parameters: ["Ada", null, "Grace", "grace@example.com"],
    parameterSqlTypes: ["text", "text", "text", "text"],
  })
  expectTypeOf(query.row).toEqualTypeOf<{
    id: number
    name: string
  }>()
})

test("passes explicit custom column domains to mutation parameters", () => {
  const records = table("custom_records", {
    handle: column({
      sqlType: "postgres.citext",
      storage: nativeStorage("postgresql", "CITEXT"),
    }),
  })
  const query = insertInto(records, values({ handle: "Ada" }))

  expect(render(query)).toMatchObject({
    parameters: ["Ada"],
    parameterSqlTypes: ["postgres.citext"],
  })
})

test("renders INSERT expressions directly while encoding raw application values", () => {
  const labels = table("labels", {
    name: text({
      codec: {
        toDriver: (input: string) => input.toUpperCase(),
        fromDriver: (value: unknown) => String(value).toLowerCase(),
      },
    }),
  })
  const query = insertInto(labels, values({ name: "encoded" }, { name: upper("expression") }))

  expect(render(query)).toEqual({
    text: 'INSERT INTO "labels" ("name") VALUES (?), (UPPER(?))',
    parameters: ["ENCODED", "expression"],
    parameterSqlTypes: ["text", undefined],
  })
})

test("renders PostgreSQL ON CONFLICT DO UPDATE with excluded values and a condition", () => {
  const incoming = excluded(accounts)
  const query = insertInto(
    accounts,
    values({
      email: "ada@example.com",
      name: "Ada",
      version: 2,
    }),
    onConflict(
      accounts,
      accounts.constraints.emailKey,
      doUpdate({ name: incoming.name }, where(gt(incoming.version, accounts.version))),
    ),
    returning({
      id: accounts.id,
      name: accounts.name,
    }),
  )

  expect(render(query, postgresDialect())).toEqual({
    text: 'INSERT INTO "accounts" ("email", "name", "version") VALUES ($1, $2, $3) ON CONFLICT ("email") DO UPDATE SET "name" = excluded."name" WHERE (excluded."version" > "accounts"."version") RETURNING "accounts"."id" AS "id", "accounts"."name" AS "name"',
    parameters: ["ada@example.com", "Ada", 2],
    parameterSqlTypes: ["text", "text", "integer"],
  })
})

test("renders ordinary and partial PostgreSQL unique indexes as conflict targets", () => {
  const incoming = excluded(indexedAccounts)
  const row = {
    email: "ada@example.com",
    active: true,
    name: "Ada",
  }

  expect(
    render(
      insertInto(
        indexedAccounts,
        values(row),
        onConflict(indexedAccounts, indexedAccounts.indexes.emailIndex, doNothing()),
      ),
      postgresDialect(),
    ),
  ).toEqual({
    text: 'INSERT INTO "indexed_accounts" ("email", "active", "name") VALUES ($1, $2, $3) ON CONFLICT ("email") DO NOTHING',
    parameters: ["ada@example.com", true, "Ada"],
    parameterSqlTypes: ["text", "boolean", "text"],
  })

  expect(
    render(
      insertInto(
        indexedAccounts,
        values(row),
        onConflict(
          indexedAccounts,
          indexedAccounts.indexes.activeEmailIndex,
          doUpdate({ name: incoming.name }),
        ),
      ),
      postgresDialect(),
    ),
  ).toEqual({
    text: 'INSERT INTO "indexed_accounts" ("email", "active", "name") VALUES ($1, $2, $3) ON CONFLICT ("email") WHERE ("active" = TRUE) DO UPDATE SET "name" = excluded."name"',
    parameters: ["ada@example.com", true, "Ada"],
    parameterSqlTypes: ["text", "boolean", "text"],
  })
})

test("rejects invalid unique-index conflict targets with structured diagnostics", () => {
  let error: unknown

  try {
    onConflict(indexedAccounts, indexedAccounts.indexes.nameLookup as never, doNothing())
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(QueryValidationError)
  expect((error as QueryValidationError).issue).toMatchObject({
    code: "invalid-mutation",
    context: "upsert.conflict.target",
    path: ["onConflict", "target"],
  })

  const portableQuery = insertInto(
    indexedAccounts,
    values({
      email: "ada@example.com",
      active: true,
      name: "Ada",
    }),
    onConflict(indexedAccounts, indexedAccounts.indexes.emailIndex, doNothing()),
  )

  expect(() => render(portableQuery, sqliteDialect())).toThrowError(QueryValidationError)
})

test("renders SQLite ON CONFLICT DO NOTHING without a target", () => {
  const query = insertInto(
    accounts,
    values({
      email: "ada@example.com",
      name: "Ada",
      version: 1,
    }),
    onConflict(doNothing()),
  )

  expect(render(query, sqliteDialect())).toEqual({
    text: 'INSERT INTO "accounts" ("email", "name", "version") VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
    parameters: ["ada@example.com", "Ada", 1],
    parameterSqlTypes: ["text", "text", "integer"],
  })
})

test("renders DEFAULT VALUES when a table has only generated/default columns", () => {
  const audit = table("audit", {
    id: integer({ generated: true }),
    createdAt: text({ hasDefault: true }),
  })
  const query = insertInto(audit, defaultValues(), returning(all(audit)))

  expect(render(query).text).toBe(
    'INSERT INTO "audit" DEFAULT VALUES RETURNING "audit"."id" AS "id", "audit"."created_at" AS "createdAt"',
  )
})

test("materializes and encodes runtime defaults for each inserted row", () => {
  let next = 0
  const sessions = table("sessions", {
    id: integer({ generated: true }),
    token: text({
      defaultFn: () => `token-${++next}`,
      codec: {
        toDriver: (value: string) => value.toUpperCase(),
        fromDriver: (value: unknown) => String(value).toLowerCase(),
      },
    }),
  })

  expect(render(insertInto(sessions, values({}, {})))).toEqual({
    text: 'INSERT INTO "sessions" ("token") VALUES (?), (?)',
    parameters: ["TOKEN-1", "TOKEN-2"],
    parameterSqlTypes: ["text", "text"],
  })
  expect(render(insertInto(sessions, defaultValues()))).toEqual({
    text: 'INSERT INTO "sessions" ("token") VALUES (?)',
    parameters: ["TOKEN-3"],
    parameterSqlTypes: ["text"],
  })
})

test("renders SQLite integer timestamp defaults through the native column codec", () => {
  const instant = new Date("2026-08-29T12:34:56.789Z")
  const events = table("events", {
    createdAt: sqliteTimestamp({ defaultFn: () => instant }),
    updatedAt: sqliteTimestamp({ mode: "timestamp_ms" }),
  })

  expect(render(insertInto(events, values({ updatedAt: instant })), sqliteDialect())).toEqual({
    text: 'INSERT INTO "events" ("updated_at", "created_at") VALUES (?, ?)',
    parameters: [instant.getTime(), Math.floor(instant.getTime() / 1_000)],
  })
})

test("composes INSERT ... SELECT with source parameters", () => {
  const archive = table("user_archive", { name: text() })
  const names = select({ name: users.name }, from(users), where(eq(users.id, 9)))
  const query = insertInto(archive, insertSelect(names, ["name"]))

  expect(render(query)).toEqual({
    text: 'INSERT INTO "user_archive" ("name") SELECT "users"."name" AS "name" FROM "users" WHERE ("users"."id" = ?)',
    parameters: [9],
  })
})

test("prefixes insert, update, and delete mutations with ordinary and recursive CTEs", () => {
  const selectedUsers = cte(
    "selected_users",
    select({ id: users.id, name: users.name }, from(users), where(eq(users.id, 7))),
  )
  const archive = table("user_archive", { name: text() })
  const insertion = insertInto(
    archive,
    insertSelect(select({ name: selectedUsers.name }, from(selectedUsers)), ["name"]),
    withCte(selectedUsers),
    returning({ name: archive.name }),
  )

  expect(render(insertion)).toEqual({
    text: 'WITH "selected_users" AS (SELECT "users"."id" AS "id", "users"."name" AS "name" FROM "users" WHERE ("users"."id" = ?)) INSERT INTO "user_archive" ("name") SELECT "selected_users"."name" AS "name" FROM "selected_users" RETURNING "user_archive"."name" AS "name"',
    parameters: [7],
  })

  const numbers = recursiveCte("numbers", select({ id: cast(value(1), integer()) }), (self) =>
    select({ id: add(self.id, 1) }, from(self), where(lt(self.id, 3))),
  )
  const change = update(
    users,
    { name: "Archived" },
    withCte(numbers),
    where(inQuery(users.id, select({ id: numbers.id }, from(numbers)))),
  )

  expect(render(change)).toEqual({
    text: 'WITH RECURSIVE "numbers" ("id") AS (SELECT CAST(? AS INTEGER) AS "id" UNION ALL SELECT ("numbers"."id" + ?) AS "id" FROM "numbers" WHERE ("numbers"."id" < ?)) UPDATE "users" SET "name" = ? WHERE ("users"."id" IN (SELECT "numbers"."id" AS "id" FROM "numbers"))',
    parameters: [1, 1, 3, "Archived"],
    parameterSqlTypes: [undefined, undefined, undefined, "text"],
  })

  const removal = deleteFrom(
    users,
    withCte(selectedUsers),
    where(inQuery(users.id, select({ id: selectedUsers.id }, from(selectedUsers)))),
  )

  expect(render(removal)).toEqual({
    text: 'WITH "selected_users" AS (SELECT "users"."id" AS "id", "users"."name" AS "name" FROM "users" WHERE ("users"."id" = ?)) DELETE FROM "users" WHERE ("users"."id" IN (SELECT "selected_users"."id" AS "id" FROM "selected_users"))',
    parameters: [7],
  })
})

test("rejects duplicate mutation WITH clauses", () => {
  const selectedUsers = cte("selected_users", select({ id: users.id }, from(users)))
  let error: unknown

  try {
    deleteFrom(users, withCte(selectedUsers), withCte(selectedUsers), allowAll())
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(QueryValidationError)
  expect((error as QueryValidationError).issue).toMatchObject({
    code: "duplicate-clause",
    context: "mutation.delete.clauses",
    path: ["clauses", "with"],
  })
})

test("renders safe UPDATE and DELETE statements with typed RETURNING rows", () => {
  const changed = update(
    users,
    { name: "Ada" },
    where(eq(users.id, 7)),
    returning({
      id: users.id,
      name: users.name,
    }),
  )
  const removed = deleteFrom(users, where(eq(users.id, 8)), returning(all(users)))

  expect(render(changed)).toEqual({
    text: 'UPDATE "users" SET "name" = ? WHERE ("users"."id" = ?) RETURNING "users"."id" AS "id", "users"."name" AS "name"',
    parameters: ["Ada", 7],
    parameterSqlTypes: ["text", undefined],
  })
  expect(render(removed)).toEqual({
    text: 'DELETE FROM "users" WHERE ("users"."id" = ?) RETURNING "users"."id" AS "id", "users"."name" AS "name", "users"."email" AS "email"',
    parameters: [8],
  })
  expectTypeOf(changed.row).toEqualTypeOf<{
    id: number
    name: string
  }>()
  expectTypeOf(removed.row).toEqualTypeOf<{
    id: number
    name: string
    email: string | null
  }>()
})

test("tracks target scope through UPDATE assignment expressions", () => {
  const query = update(users, { name: upper(users.name) }, where(eq(users.id, 10)))

  expect(render(query)).toEqual({
    text: 'UPDATE "users" SET "name" = UPPER("users"."name") WHERE ("users"."id" = ?)',
    parameters: [10],
  })
})

test("renders PostgreSQL UPDATE FROM in clause order with source expressions", () => {
  const changes = table("user_changes", {
    userId: integer(),
    name: text(),
  })
  const query = update(
    users,
    { name: upper(changes.name) },
    returning({
      id: users.id,
      sourceName: changes.name,
    }),
    where(eq(users.id, changes.userId)),
    updateFrom(changes),
  )

  expect(render(query, postgresDialect())).toEqual({
    text: 'UPDATE "users" SET "name" = UPPER("user_changes"."name") FROM "user_changes" WHERE ("users"."id" = "user_changes"."user_id") RETURNING "users"."id" AS "id", "user_changes"."name" AS "sourceName"',
    parameters: [],
  })
})

test("rejects UPDATE FROM when the dialect does not advertise it", () => {
  const changes = table("user_changes", { name: text() })
  const query = update(users, { name: changes.name }, updateFrom(changes), allowAll())

  expect(() => render(query as never)).toThrowError(
    'Dialect "standard-sql" does not support the "update-from" capability',
  )
})

test("omits conditional UPDATE assignments while preserving SQL values", () => {
  const conditionalUpdate = (includeName: boolean, email: string | null | undefined, id: number) =>
    update(
      users,
      {
        name: includeName ? upper(users.name) : omit,
        email,
      },
      where(eq(users.id, id)),
    )

  const enabled = conditionalUpdate(true, null, 11)
  const disabled = conditionalUpdate(false, undefined, 12)

  expect(render(enabled)).toEqual({
    text: 'UPDATE "users" SET "name" = UPPER("users"."name"), "email" = ? WHERE ("users"."id" = ?)',
    parameters: [null, 11],
    parameterSqlTypes: ["text", undefined],
  })
  expect(render(disabled)).toEqual({
    text: 'UPDATE "users" SET "email" = ? WHERE ("users"."id" = ?)',
    parameters: [undefined, 12],
    parameterSqlTypes: ["text", undefined],
  })
})

test("rejects an UPDATE whose assignments are all omitted", () => {
  expect(() => update(users, { name: omit }, allowAll())).toThrowError(
    "UPDATE requires at least one assignment",
  )
})

test("requires an explicit unrestricted-mutation opt-in", () => {
  expect(() => {
    // @ts-expect-error UPDATE requires WHERE or allowAll().
    update(users, { name: "Ada" })
  }).toThrowError(/requires a WHERE/)
  expect(() => {
    // @ts-expect-error DELETE requires WHERE or allowAll().
    deleteFrom(users)
  }).toThrowError(/requires a WHERE/)

  const unrestricted = update(users, { name: "Ada" }, allowAll())

  expect(render(unrestricted).text).toBe('UPDATE "users" SET "name" = ?')
})
