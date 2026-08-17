import { parenthesize } from '../core/fragment.ts'
import type { Query } from '../query/types.ts'
import { makeExpression, type Expression } from './types.ts'

export type SingleColumn<Row extends object> = keyof Row extends infer TKey
  ? TKey extends keyof Row
    ? [keyof Row] extends [TKey]
      ? Row[TKey]
      : never
    : never
  : never

export function scalar<TRow extends object, TParameters>(
  query: Query<TRow, TParameters>
): Expression<SingleColumn<TRow>, never, TParameters, 'subquery'> {
  if (Object.keys(query.row).length !== 1) {
    throw new Error(
      'scalar() requires a query with exactly one selected column'
    )
  }

  return makeExpression('subquery', context =>
    context.render(parenthesize(query))
  )
}
