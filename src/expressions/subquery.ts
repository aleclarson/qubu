import {
  type InheritedMetadata,
  parenthesize,
  type CardinalityOf,
  type ResultMeta,
} from '../core/fragment.ts'
import type { AnyQuery, QueryRow } from '../query/types.ts'
import { makeExpression, type Expression } from './types.ts'

export type SingleColumn<Row extends object> = keyof Row extends infer TKey
  ? TKey extends keyof Row
    ? [keyof Row] extends [TKey]
      ? Row[TKey]
      : never
    : never
  : never

type ScalarOutput<TQuery extends AnyQuery> =
  | SingleColumn<QueryRow<TQuery>>
  | ([CardinalityOf<TQuery>] extends ['exactly-one'] ? never : null)

export function scalar<TQuery extends AnyQuery>(
  query: TQuery
): Expression<
  ResultMeta<ScalarOutput<TQuery>> | InheritedMetadata<TQuery>,
  'subquery'
> {
  if (Object.keys(query.row).length !== 1) {
    throw new Error(
      'scalar() requires a query with exactly one selected column'
    )
  }

  return makeExpression<
    ResultMeta<ScalarOutput<TQuery>> | InheritedMetadata<TQuery>,
    'subquery'
  >('subquery', context =>
    context.renderRelation(parenthesize(query))
  ) as Expression<
    ResultMeta<ScalarOutput<TQuery>> | InheritedMetadata<TQuery>,
    'subquery'
  >
}
