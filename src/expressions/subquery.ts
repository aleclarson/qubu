import { parenthesize } from '../core/fragment.ts'
import type { Query } from '../query/types.ts'
import { makeExpression, type ResultExpression } from './types.ts'
import type { ResultMeta } from '../core/fragment.ts'

export type SingleColumn<Row extends object> = keyof Row extends infer TKey
  ? TKey extends keyof Row
    ? [keyof Row] extends [TKey]
      ? Row[TKey]
      : never
    : never
  : never

export function scalar<TRow extends object>(
  query: Query<TRow>
): ResultExpression<SingleColumn<TRow>, never, 'subquery'> {
  if (Object.keys(query.row).length !== 1) {
    throw new Error(
      'scalar() requires a query with exactly one selected column'
    )
  }

  return makeExpression<ResultMeta<SingleColumn<TRow>>, 'subquery'>(
    'subquery',
    context => context.render(parenthesize(query))
  ) as ResultExpression<SingleColumn<TRow>, never, 'subquery'>
}
