import { expectTypeOf } from "vitest"

import { mysqlDialect } from "../src/dialects/mysql.ts"
import {
  doNothing,
  doUpdate,
  excluded,
  onConflict,
  postgresDialect,
} from "../src/dialects/postgres.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import {
  all,
  eq,
  gt,
  index,
  insertInto,
  integer,
  render,
  returning,
  table,
  text,
  unique,
  value,
  values,
  where,
} from "../src/index.ts"

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
    indexes: {
      emailIndex: index([accounts.email], { unique: true }),
      activeEmailIndex: index([accounts.email], {
        unique: true,
        where: eq(accounts.name, value("active")),
        dialect: { dialect: "postgresql" },
      }),
      lookupIndex: index([accounts.name]),
      sqliteEmailIndex: index([accounts.email], {
        unique: true,
        dialect: { dialect: "sqlite" },
      }),
    },
  }),
)
const other = table("other", { name: text() })

const incoming = excluded(accounts)
const query = insertInto(
  accounts,
  values({
    email: "ada@example.com",
    name: "Ada",
    version: 1,
  }),
  onConflict(
    accounts,
    accounts.constraints.emailKey,
    doUpdate({ name: incoming.name }, where(gt(incoming.version, accounts.version))),
  ),
  returning(all(accounts)),
)

expectTypeOf(query.row).toEqualTypeOf<{
  id: number
  email: string
  name: string
  version: number
}>()

render(query, postgresDialect())
render(query, sqliteDialect())

// @ts-expect-error ON CONFLICT is not advertised by MySQL.
render(query, mysqlDialect())

onConflict(accounts, accounts.indexes.emailIndex, doNothing())
onConflict(accounts, accounts.indexes.activeEmailIndex, doUpdate({ name: incoming.name }))

// @ts-expect-error Non-unique indexes cannot arbitrate a PostgreSQL conflict.
onConflict(accounts, accounts.indexes.lookupIndex, doNothing())

// @ts-expect-error Indexes declared for another dialect cannot arbitrate a PostgreSQL conflict.
onConflict(accounts, accounts.indexes.sqliteEmailIndex, doNothing())

insertInto(
  accounts,
  values({
    email: "ada@example.com",
    name: "Ada",
    version: 1,
  }),
  onConflict(doNothing()),
)

onConflict(
  accounts,
  accounts.constraints.emailKey,
  // @ts-expect-error DO UPDATE expressions cannot reference an unrelated source.
  doUpdate({ name: excluded(other).name }),
)

// @ts-expect-error DO UPDATE needs a target table and conflict target.
onConflict(doUpdate({ name: incoming.name }))
