import { parenthesize } from '../../../core/fragment.ts'
import type { Query } from '../../../query/types.ts'
import { makeExpression, type Expression } from '../../types.ts'
import type { BooleanExpression } from './types.ts'

export function inQuery<T, TReq, TParams, TQuery extends Query<any, any>>(
  expression: Expression<T, TReq, TParams, any>,
  query: TQuery
) {
  return makeExpression('subquery', context => {
    context.append('(')
    context.render(expression)
    context.append(' IN ')
    context.render(parenthesize(query))
    context.append(')')
  }) as BooleanExpression<
    TReq,
    TParams | (TQuery extends Query<any, infer P> ? P : never),
    'subquery'
  >
}

export const inSelect = inQuery

export function exists<TQuery extends Query<any, any>>(query: TQuery) {
  return makeExpression('subquery', context => {
    context.append('EXISTS ')
    context.render(parenthesize(query))
  }) as BooleanExpression<
    never,
    TQuery extends Query<any, infer P> ? P : never,
    'subquery'
  >
}

export function notExists<TQuery extends Query<any, any>>(query: TQuery) {
  return makeExpression('subquery', context => {
    context.append('NOT EXISTS ')
    context.render(parenthesize(query))
  }) as BooleanExpression<
    never,
    TQuery extends Query<any, infer P> ? P : never,
    'subquery'
  >
}
