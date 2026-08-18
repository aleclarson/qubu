import { parenthesize } from '../../../core/fragment.ts'
import type { Query } from '../../../query/types.ts'
import {
  makeExpression,
  type AnyExpression,
  type ResultExpression,
} from '../../types.ts'

export function inQuery<
  TExpression extends AnyExpression,
  TQuery extends Query<any, any, any>,
>(
  expression: TExpression,
  query: TQuery
): ResultExpression<boolean, TExpression | TQuery, 'subquery', never> {
  return makeExpression('subquery', context => {
    context.append('(')
    context.render(expression)
    context.append(' IN ')
    context.render(parenthesize(query))
    context.append(')')
  }) as ResultExpression<boolean, TExpression | TQuery, 'subquery', never>
}

export const inSelect = inQuery

export function exists<TQuery extends Query<any, any, any>>(query: TQuery) {
  return makeExpression('subquery', context => {
    context.append('EXISTS ')
    context.render(parenthesize(query))
  }) as ResultExpression<boolean, TQuery, 'subquery', never>
}

export function notExists<TQuery extends Query<any, any, any>>(query: TQuery) {
  return makeExpression('subquery', context => {
    context.append('NOT EXISTS ')
    context.render(parenthesize(query))
  }) as ResultExpression<boolean, TQuery, 'subquery', never>
}
