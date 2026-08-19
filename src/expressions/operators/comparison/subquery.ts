import { parenthesize } from '../../../core/fragment.ts'
import type { Query, QueryRow, QuerySqlTypeMap } from '../../../query/types.ts'
import {
  makeExpression,
  type AnyExpression,
  type SubqueryResultExpression,
  type ExpressionOutput,
  type ExpressionSqlType,
} from '../../types.ts'
import type { SingleColumn } from '../../subquery.ts'
import type { SqlBoolean } from '../../../core/sql-types.ts'
import type { SqlEqualityValidation } from '../shared.ts'

type IsUnion<T, TWhole = T> = T extends unknown
  ? [TWhole] extends [T]
    ? false
    : true
  : never

type InQueryValidation<TExpression, TQuery> = [keyof QueryRow<TQuery>] extends [
  never,
]
  ? { readonly __requires_single_column_subquery__: never }
  : true extends IsUnion<keyof QueryRow<TQuery>>
    ? { readonly __requires_single_column_subquery__: never }
    : SingleColumn<QueryRow<TQuery>> extends ExpressionOutput<TExpression>
      ? SqlEqualityValidation<
          ExpressionSqlType<TExpression>,
          SingleColumn<QuerySqlTypeMap<TQuery>>
        >
      : {
          readonly __incompatible_subquery_output__: SingleColumn<
            QueryRow<TQuery>
          >
        }

export function inQuery<
  TExpression extends AnyExpression,
  TQuery extends Query<any, any, any>,
>(
  expression: TExpression & InQueryValidation<TExpression, TQuery>,
  query: TQuery
): SubqueryResultExpression<boolean, TExpression | TQuery, never, SqlBoolean> {
  return makeExpression('subquery', context => {
    context.append('(')
    context.render(expression)
    context.append(' IN ')
    context.renderRelation(parenthesize(query))
    context.append(')')
  }) as SubqueryResultExpression<
    boolean,
    TExpression | TQuery,
    never,
    SqlBoolean
  >
}

export const inSelect = inQuery

export function exists<TQuery extends Query<any, any, any>>(query: TQuery) {
  return makeExpression('subquery', context => {
    context.append('EXISTS ')
    context.renderRelation(parenthesize(query))
  }) as SubqueryResultExpression<boolean, TQuery, never, SqlBoolean>
}

export function notExists<TQuery extends Query<any, any, any>>(query: TQuery) {
  return makeExpression('subquery', context => {
    context.append('NOT EXISTS ')
    context.renderRelation(parenthesize(query))
  }) as SubqueryResultExpression<boolean, TQuery, never, SqlBoolean>
}
