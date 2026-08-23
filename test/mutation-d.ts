import {
  allowAll,
  type CapabilitiesOf,
  integer,
  omit,
  table,
  text,
  update,
  upper,
} from '../src/index.ts'
import { withDialectCapability } from '../src/core/index.ts'

const users = table('users', {
  id: integer({ generated: true }),
  name: text(),
  email: text({ nullable: true }),
})
const posts = table('posts', { name: text() })
declare const enabled: boolean

update(
  users,
  {
    name: enabled ? upper(users.name) : omit,
    email: enabled ? null : undefined,
  },
  allowAll()
)

update(
  users,
  // @ts-expect-error Possible omitted expressions still require the target source.
  {
    name: enabled ? upper(posts.name) : omit,
  },
  allowAll()
)

const capabilityQuery = update(
  users,
  {
    name: enabled ? withDialectCapability(upper(users.name), 'ilike') : omit,
  },
  allowAll()
)

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false
type Assert<TCondition extends true> = TCondition

export type ConditionalAssignmentRetainsCapabilities = Assert<
  Equal<CapabilitiesOf<typeof capabilityQuery>, 'ilike'>
>
