import { withDialectCapability } from "../src/core/index.ts"
import { sqliteTimestamp } from "../src/dialects/sqlite.ts"
import {
  allowAll,
  type CapabilitiesOf,
  integer,
  insertInto,
  omit,
  table,
  text,
  update,
  upper,
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
