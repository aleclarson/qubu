import {
  alias,
  count,
  cte,
  customSource,
  eq,
  from,
  groupBy,
  having,
  identifier,
  integer,
  leftJoin,
  orderBy,
  primaryKey,
  select,
  table,
  text,
  unique,
  withCte,
} from '../src/index.ts'

const users = table(
  'users',
  {
    id: integer(),
    email: text(),
    name: text(),
  },
  {
    constraints: [primaryKey('id'), unique('email')],
  }
)

const memberships = table(
  'memberships',
  {
    tenantId: integer(),
    slug: text(),
    displayName: text(),
  },
  {
    constraints: [unique('tenantId', 'slug')],
  }
)

const unconstrained = table('unconstrained_users', {
  id: integer(),
  name: text(),
})

select(
  { name: users.name, total: count() },
  from(users),
  groupBy(users.id),
  having(eq(users.name, 'Ada')),
  orderBy(users.name)
)

select({ name: users.name, total: count() }, from(users), groupBy(users.email))

select(
  { displayName: memberships.displayName, total: count() },
  from(memberships),
  groupBy(memberships.tenantId, memberships.slug)
)

const members = alias(memberships, 'members')
select(
  { displayName: members.displayName, total: count() },
  from(members),
  groupBy(members.tenantId, members.slug)
)

select(
  { name: users.name, displayName: memberships.displayName, total: count() },
  from(users),
  leftJoin(memberships, eq(users.id, memberships.tenantId)),
  groupBy(users.id, memberships.tenantId, memberships.slug)
)

select(
  { name: unconstrained.name, total: count() },
  // @ts-expect-error A field name alone does not prove a functional dependency.
  from(unconstrained),
  groupBy(unconstrained.id)
)

select(
  { displayName: memberships.displayName, total: count() },
  // @ts-expect-error Every column in a composite unique key must be grouped.
  from(memberships),
  groupBy(memberships.tenantId)
)

const derivedUsers = alias(
  select({ id: users.id, name: users.name }, from(users)),
  'derived_users'
)
select(
  { name: derivedUsers.name, total: count() },
  // @ts-expect-error A derived query does not automatically preserve source keys.
  from(derivedUsers),
  groupBy(derivedUsers.id)
)

const userCte = cte(
  'user_cte',
  select({ id: users.id, name: users.name }, from(users))
)
select(
  { name: userCte.name, total: count() },
  // @ts-expect-error A CTE projection does not automatically preserve source keys.
  withCte(userCte),
  from(userCte),
  groupBy(userCte.id)
)

const generatedRows = customSource({
  identity: { sourceKind: 'custom', name: 'generated_rows' },
  reference: identifier('generated_rows'),
  columns: { id: integer(), value: text() },
  render(context) {
    context.append('generated_rows')
  },
})
select(
  { value: generatedRows.value, total: count() },
  // @ts-expect-error A custom source has no key proof unless its model declares one.
  from(generatedRows),
  groupBy(generatedRows.id)
)

table(
  'nullable_unique',
  { email: text({ nullable: true }) },
  // @ts-expect-error Nullable SQL unique columns do not prove a functional dependency.
  { constraints: [unique('email')] }
)

table(
  'invalid_key',
  { id: integer() },
  // @ts-expect-error Constraints can only reference declared application field keys.
  { constraints: [primaryKey('missing')] }
)
