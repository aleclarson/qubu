import {
  count,
  crossJoin,
  cte,
  eq,
  fetchFirst,
  from,
  groupBy,
  integer,
  select,
  table,
  type CardinalityOf,
  where,
  withCte,
} from "../src/index.ts"

const games = table("games", { id: integer() })
const otherGames = table("other_games", { id: integer() })
const resolvedCursor = cte("resolved_cursor", select({ id: games.id }, from(games)))

declare const enabled: boolean

function cursorParts(cursor: typeof resolvedCursor | undefined) {
  return cursor
    ? ([withCte(cursor), crossJoin(cursor), where(eq(games.id, cursor.id))] as const)
    : ([] as const)
}

declare const optionalCursor: typeof resolvedCursor | undefined

select({ id: games.id }, from(games), ...cursorParts(optionalCursor))

const fixedCursorParts = [withCte(resolvedCursor), crossJoin(resolvedCursor)] as const

select({ id: resolvedCursor.id }, from(games), ...fixedCursorParts)

select(
  { id: otherGames.id },
  // @ts-expect-error Tuple spreads retain source validation.
  from(games),
  ...cursorParts(optionalCursor),
)

select(
  { id: resolvedCursor.id },
  // @ts-expect-error A source introduced by only one tuple branch is not always available.
  from(games),
  ...cursorParts(optionalCursor),
)

select(
  { id: games.id },
  // @ts-expect-error Each tuple branch must provide the sources required by that branch.
  from(games),
  ...(enabled
    ? ([crossJoin(resolvedCursor)] as const)
    : ([where(eq(games.id, resolvedCursor.id))] as const)),
)

const conditionallyLimited = select(
  { id: games.id },
  from(games),
  ...(enabled ? ([fetchFirst(1)] as const) : ([] as const)),
)

export type ConditionalTuplePaginationRemainsConservative = Assert<
  Equal<CardinalityOf<typeof conditionallyLimited>, "many">
>

select(
  {
    id: games.id,
    total: count(),
  },
  // @ts-expect-error Every possible tuple branch must satisfy grouping rules.
  from(games),
  ...(enabled ? ([groupBy(games.id)] as const) : ([] as const)),
)

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition
