import {
  type InheritedMetadata,
  parenthesize,
  type CardinalityOf,
  type ResultMeta,
  type SubqueryMeta,
} from '../core/fragment.ts'
import type { AnyQuery, QueryRow, QuerySqlTypeMap } from '../query/types.ts'
import { makeExpression, type Expression } from './types.ts'
import { queryValidationError } from '../query/errors.ts'

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
    throw queryValidationError({
      code: 'invalid-subquery',
      context: 'expression.scalar.query',
      path: ['scalar', 'query', 'row'],
      message: 'scalar() requires a query with exactly one selected column',
      hint: 'Select exactly one named field before wrapping the query in scalar().',
    })
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
