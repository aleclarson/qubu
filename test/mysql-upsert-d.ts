import { expectTypeOf } from "vitest"

import { incoming, mysqlDialect, onDuplicateKeyUpdate } from "../src/dialects/mysql.ts"
import { postgresDialect } from "../src/dialects/postgres.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import {
  insertInto,
  integer,
  render,
  returning,
  select,
  table,
  text,
  values,
} from "../src/index.ts"
import type { CapabilitiesOf, OutputOf } from "../src/index.ts"

const accounts = table("mysql_accounts", {
  id: integer({ generated: true }),
  name: text(),
  count: integer(),
})
const other = table("other", {
  name: text(),
  count: integer(),
})
const proposed = incoming(accounts)

expectTypeOf<OutputOf<typeof proposed.name>>().toEqualTypeOf<string>()
const query = insertInto(
  accounts,
  values({
    name: "Ada",
    count: 1,
  }),
  onDuplicateKeyUpdate(accounts, {
    name: proposed.name,
    count: accounts.count,
  }),
)

expectTypeOf<CapabilitiesOf<typeof query>>().toEqualTypeOf<"on-duplicate-key-update">()
expectTypeOf(query.queryKind).toEqualTypeOf<"insert">()
render(query, mysqlDialect())
// @ts-expect-error MySQL syntax requires its dialect.
render(query, postgresDialect())
// @ts-expect-error SQLite cannot render duplicate-key updates.
render(query, sqliteDialect())
// @ts-expect-error Incoming values cannot escape their assignment scope.
select({ name: proposed.name })
insertInto(
  accounts,
  // @ts-expect-error Incoming values cannot be insert input.
  values({
    name: proposed.name,
    count: 1,
  }),
)
// @ts-expect-error Assignment values must match target columns.
onDuplicateKeyUpdate(accounts, { count: proposed.name })
// @ts-expect-error Generated columns cannot be updated.
onDuplicateKeyUpdate(accounts, { id: 1 })
// @ts-expect-error Unknown assignment columns are rejected.
onDuplicateKeyUpdate(accounts, { typo: 1 })
// @ts-expect-error Unrelated source is unavailable.
onDuplicateKeyUpdate(accounts, { name: other.name })
// @ts-expect-error Incoming values belong to one target.
onDuplicateKeyUpdate(accounts, { name: incoming(other).name })
insertInto(
  accounts,
  values({
    name: "Ada",
    count: 1,
  }),
  // @ts-expect-error Clause target must match insert target.
  onDuplicateKeyUpdate(other, { name: "Grace" }),
)
// @ts-expect-error MySQL does not take a conflict target argument.
onDuplicateKeyUpdate(accounts, accounts.id, { name: "Grace" })

insertInto(
  accounts,
  values({
    name: "Ada",
    count: 1,
  }),
  // @ts-expect-error MySQL duplicate-key updates have no RETURNING clause.
  onDuplicateKeyUpdate(accounts, { name: "Grace" }),
  returning({ name: accounts.name }),
)
