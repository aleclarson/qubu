import {
  eq,
  fetchFirst,
  fetchNext,
  from,
  integer,
  omit,
  offset,
  scalar,
  select,
  table,
  value,
  where,
} from "../src/index.ts"

export const users = table("users", {
  id: integer(),
})

export const ordinaryQuery = select({ id: users.id }, from(users))

export const limitedQuery = select(
  { id: users.id },
  from(users),
  where(eq(users.id, 7)),
  fetchFirst(1),
)

export const nextLimitedQuery = select({ id: users.id }, from(users), fetchNext(1))

export const wideLimitQuery = select({ id: users.id }, from(users), fetchFirst(2))

const conditionalPagination = false as boolean

export const conditionalLimitedQuery = select(
  { id: users.id },
  from(users),
  conditionalPagination ? fetchFirst(1) : omit,
)

export const conditionalNextLimitedQuery = select(
  { id: users.id },
  from(users),
  conditionalPagination ? fetchNext(1) : omit,
)

export const conditionalOffsetQuery = select(
  { value: value(42) },
  conditionalPagination ? offset(1) : omit,
)

export const exactQuery = select({ value: value(42) })

export const filteredConstantQuery = select({ value: value(42) }, where(eq(value(1), value(2))))

export const ordinaryScalar = scalar(ordinaryQuery)
export const limitedScalar = scalar(limitedQuery)
export const nextLimitedScalar = scalar(nextLimitedQuery)
export const exactScalar = scalar(exactQuery)
export const filteredConstantScalar = scalar(filteredConstantQuery)
