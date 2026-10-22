import {
  alias,
  avg,
  count,
  countDistinct,
  eq,
  type EmptyAggregateInput,
  type NullabilityOf,
  type SourceIdentity,
  from,
  groupBy,
  integer,
  leftJoin,
  max,
  min,
  omit,
  over,
  select,
  sum,
  table,
  upper,
  value,
  where,
} from "../src/index.ts"
import { users } from "./grouping-fixtures.ts"

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

const projection = {
  total: sum(users.id),
  minimum: min(users.id),
  maximum: max(users.id),
  average: avg(users.id),
  rows: count(),
  ids: count(users.id),
  distinct: countDistinct(users.id),
  name: upper(min(users.name)),
}
const total = projection.total
const rowCount = projection.rows

export type AggregateProvenance = [
  Assert<Equal<NullabilityOf<typeof total>, SourceIdentity<typeof users> | EmptyAggregateInput>>,
  Assert<Equal<NullabilityOf<typeof rowCount>, never>>,
]

const ungrouped = select(projection, from(users))
const grouped = select(projection, from(users), groupBy(users.name))
const windowed = select(
  {
    total: over(sum(users.id)),
    minimum: over(min(users.id)),
    maximum: over(max(users.id)),
    average: over(avg(users.id), {
      partitionBy: [users.id],
      orderBy: [users.id],
    }),
    count: over(count(users.id)),
  },
  from(users),
)
const nullable = table("nullable", { amount: integer({ nullable: true }) })
const nullableProjection = {
  total: sum(nullable.amount),
  minimum: min(nullable.amount),
  maximum: max(nullable.amount),
  average: avg(nullable.amount),
}
const nullableGroup = select(nullableProjection, from(nullable), groupBy(nullable.amount))
const nullableWindow = select({ average: over(avg(nullable.amount)) }, from(nullable))
const joined = alias(users, "joined")
const joinedWindow = select(
  {
    total: over(sum(joined.id)),
    count: over(count(joined.id)),
  },
  from(users),
  leftJoin(joined, eq(users.id, joined.id)),
)
const derived = alias(ungrouped, "summary")
const composed = select({ total: derived.total }, from(derived))

declare const conditional: boolean
const optionalFilter = select({ total: sum(value(1)) }, conditional ? where(eq(value(1), 0)) : omit)
const sourceFree = select({ total: sum(value(1)) })
const filteredConstant = select({ total: sum(value(1)) }, where(eq(value(1), 0)))

export type AggregateNullability = [
  Assert<
    Equal<
      typeof ungrouped.row,
      {
        total: number | null
        minimum: number | null
        maximum: number | null
        average: number | null
        rows: number
        ids: number
        distinct: number
        name: string | null
      }
    >
  >,
  Assert<
    Equal<
      typeof grouped.row,
      {
        total: number
        minimum: number
        maximum: number
        average: number
        rows: number
        ids: number
        distinct: number
        name: string
      }
    >
  >,
  Assert<
    Equal<
      typeof windowed.row,
      {
        total: number
        minimum: number
        maximum: number
        average: number
        count: number
      }
    >
  >,
  Assert<
    Equal<
      typeof nullableGroup.row,
      {
        total: number | null
        minimum: number | null
        maximum: number | null
        average: number | null
      }
    >
  >,
  Assert<Equal<typeof nullableWindow.row, { average: number | null }>>,
  Assert<
    Equal<
      typeof joinedWindow.row,
      {
        total: number | null
        count: number
      }
    >
  >,
  Assert<Equal<typeof composed.row, { total: number | null }>>,
  Assert<Equal<typeof optionalFilter.row, { total: number | null }>>,
  Assert<Equal<typeof sourceFree.row, { total: number }>>,
  Assert<Equal<typeof filteredConstant.row, { total: number | null }>>,
]
