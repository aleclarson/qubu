import {
  alias,
  avg,
  count,
  countDistinct,
  eq,
  from,
  fullJoin,
  groupBy,
  innerJoin,
  isNull,
  leftJoin,
  rightJoin,
  select,
  upper,
} from "../src/index.ts"
import { posts, users } from "./grouping-fixtures.ts"

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

const later = alias(users, "later")
const right = select(
  {
    name: upper(users.name),
    title: posts.title,
    missing: isNull(users.id),
  },
  rightJoin(posts, eq(users.id, posts.authorId)),
  from(users),
)
const full = select(
  {
    name: users.name,
    title: upper(posts.title),
  },
  from(users),
  fullJoin(posts, eq(users.id, posts.authorId)),
)
const composedParts = [
  leftJoin(posts, eq(users.id, posts.authorId)),
  rightJoin(later, eq(posts.authorId, later.id)),
] as const
const composed = select(
  {
    name: users.name,
    title: posts.title,
    later: later.name,
  },
  ...composedParts,
  from(users),
)
const laterInner = select(
  {
    name: users.name,
    title: posts.title,
    later: later.name,
  },
  from(users),
  rightJoin(posts, eq(users.id, posts.authorId)),
  innerJoin(later, eq(later.id, posts.authorId)),
)
const counts = select(
  {
    rows: count(),
    ids: count(users.id),
    distinct: countDistinct(posts.id),
    average: avg(users.id),
  },
  from(users),
  fullJoin(posts, eq(users.id, posts.authorId)),
  groupBy(posts.title),
)
const multipleFrom = select(
  {
    name: users.name,
    title: posts.title,
    later: later.name,
  },
  rightJoin(later, eq(users.id, later.id)),
  from(users, posts),
)

declare const chooseRight: boolean
const conditionalJoin = select(
  {
    name: users.name,
    title: posts.title,
  },
  from(users),
  ...(chooseRight
    ? ([rightJoin(posts, eq(users.id, posts.authorId))] as const)
    : ([innerJoin(posts, eq(users.id, posts.authorId))] as const)),
)

export type OuterJoinResults = [
  Assert<
    Equal<
      typeof conditionalJoin.row,
      {
        name: string | null
        title: string
      }
    >
  >,
  Assert<
    Equal<
      typeof right.row,
      {
        name: string | null
        title: string
        missing: boolean
      }
    >
  >,
  Assert<
    Equal<
      typeof full.row,
      {
        name: string | null
        title: string | null
      }
    >
  >,
  Assert<
    Equal<
      typeof composed.row,
      {
        name: string | null
        title: string | null
        later: string
      }
    >
  >,
  Assert<
    Equal<
      typeof laterInner.row,
      {
        name: string | null
        title: string
        later: string
      }
    >
  >,
  Assert<
    Equal<
      typeof counts.row,
      {
        rows: number
        ids: number
        distinct: number
        average: number | null
      }
    >
  >,
  Assert<
    Equal<
      typeof multipleFrom.row,
      {
        name: string
        title: string | null
        later: string
      }
    >
  >,
]
