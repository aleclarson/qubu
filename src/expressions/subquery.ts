import {
  type InheritedMetadata,
  parenthesize,
  type CardinalityOf,
  type ResultMeta,
  type SubqueryMeta,
} from '../core/fragment.ts'
import type { AnyQuery, QueryRow, QuerySqlTypeMap } from '../query/types.ts'
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

type SingleColumnSqlType<TQuery extends AnyQuery> = SingleColumn<
  QuerySqlTypeMap<TQuery>
>

export function scalar<TQuery extends AnyQuery>(
  query: TQuery
): Expression<
  | ResultMeta<ScalarOutput<TQuery>, never, SingleColumnSqlType<TQuery>>
  | InheritedMetadata<TQuery>
  | SubqueryMeta,
  'subquery'
> {
  if (Object.keys(query.row).length !== 1) {
    throw new Error(
      'scalar() requires a query with exactly one selected column'
    )
  }

  return makeExpression<
    | ResultMeta<ScalarOutput<TQuery>, never, SingleColumnSqlType<TQuery>>
    | InheritedMetadata<TQuery>
    | SubqueryMeta,
    'subquery'
  >('subquery', context =>
    context.renderRelation(parenthesize(query))
  ) as Expression<
    | ResultMeta<ScalarOutput<TQuery>, never, SingleColumnSqlType<TQuery>>
    | InheritedMetadata<TQuery>
    | SubqueryMeta,
    'subquery'
  >
}
