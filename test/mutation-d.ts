import { withDialectCapability } from "../src/core/index.ts"
import { postgresDialect, updateFrom } from "../src/dialects/postgres.ts"
import { sqliteTimestamp } from "../src/dialects/sqlite.ts"
import {
  allowAll,
  type CapabilitiesOf,
  eq,
  integer,
  insertInto,
  omit,
  render,
  returning,
  table,
  text,
  update,
  upper,
  value,
  values,
} from "../src/index.ts"

const users = table("users", {
  id: integer({ generated: true }),
  name: text(),
  email: text({ nullable: true }),
})
const posts = table("posts", { name: text() })
const sessions = table("sessions", {
  token: text({ defaultFn: () => crypto.randomUUID() }),
})

insertInto(sessions, values({}))

const events = table("events", {
  createdAt: sqliteTimestamp({ defaultFn: () => new Date() }),
  updatedAt: sqliteTimestamp({ mode: "timestamp_ms" }),
})

insertInto(events, values({ updatedAt: new Date() }))

insertInto(
  users,
  values({
    name: upper("Ada"),
    email: null,
  }),
)

insertInto(
  users,
  // @ts-expect-error INSERT values expressions cannot reference the target or another source.
  values({
    name: upper(users.name),
    email: null,
  }),
)

insertInto(
  users,
  // @ts-expect-error INSERT expressions must produce a target-compatible value.
  values({
    name: value(42),
    email: null,
  }),
)

const insertCapabilityQuery = insertInto(
  users,
  values({
    name: withDialectCapability(value("Ada"), "ilike"),
    email: null,
  }),
)

render(insertCapabilityQuery, postgresDialect())

// @ts-expect-error Insert value capabilities remain required by the complete query.
render(insertCapabilityQuery)

declare const enabled: boolean

update(
  users,
  {
    name: enabled ? upper(users.name) : omit,
    email: enabled ? null : undefined,
  },
  allowAll(),
)

update(
  users,
  // @ts-expect-error Possible omitted expressions still require the target source.
  {
    name: enabled ? upper(posts.name) : omit,
  },
  allowAll(),
)

const capabilityQuery = update(
  users,
  {
    name: enabled ? withDialectCapability(upper(users.name), "ilike") : omit,
  },
  allowAll(),
)

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false
type Assert<TCondition extends true> = TCondition

export type ConditionalAssignmentRetainsCapabilities = Assert<
  Equal<CapabilitiesOf<typeof capabilityQuery>, "ilike">
>

export type InsertValueRetainsCapabilities = Assert<
  Equal<CapabilitiesOf<typeof insertCapabilityQuery>, "ilike">
>

const updateFromQuery = update(
  users,
  { name: posts.name },
  updateFrom(posts),
  where(eq(users.name, posts.name)),
  returning({
    updatedName: users.name,
    sourceName: posts.name,
  }),
)

render(updateFromQuery, postgresDialect())

// @ts-expect-error The standard dialect does not advertise UPDATE ... FROM.
render(updateFromQuery)

export type UpdateFromRetainsCapability = Assert<
  Equal<CapabilitiesOf<typeof updateFromQuery>, "update-from">
>

update(
  users,
  { name: "Ada" },
  // @ts-expect-error UPDATE clauses cannot reference a source absent from the target and FROM list.
  updateFrom(posts),
  where(eq(users.name, sessions.token)),
)
