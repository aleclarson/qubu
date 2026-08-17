import type { Fragment } from '../../core/fragment.ts'
import { makeExpression, type Expression } from '../../expressions/types.ts'
import { createClause, type SelectClause } from './types.ts'

export type OrderDirection = 'ASC' | 'DESC'
export type NullsOrder = 'FIRST' | 'LAST'

export interface OrderTerm<TRequires = never, TParameters = never>
  extends Fragment<never, TRequires, TParameters> {
  readonly orderKind: 'term'
  readonly expression: Expression<any, TRequires, TParameters, any>
  readonly direction?: OrderDirection
  readonly nulls?: NullsOrder
}

function orderTerm<TRequires, TParameters>(
  expression: Expression<any, TRequires, TParameters, any>,
  direction?: OrderDirection,
  nulls?: NullsOrder
): OrderTerm<TRequires, TParameters> {
  const base = makeExpression('operator', context => {
    context.render(expression)
    if (direction) context.append(` ${direction}`)
    if (nulls) context.append(` NULLS ${nulls}`)
  })
  return Object.freeze({
    ...base,
    orderKind: 'term' as const,
    expression,
    direction,
    nulls,
  }) as OrderTerm<TRequires, TParameters>
}

export function order<TRequires, TParameters>(
  expression: Expression<any, TRequires, TParameters, any>,
  direction?: OrderDirection,
  nulls?: NullsOrder
) {
  return orderTerm(expression, direction, nulls)
}

export function asc<TRequires, TParameters>(
  expression: Expression<any, TRequires, TParameters, any>,
  nulls?: NullsOrder
) {
  return orderTerm(expression, 'ASC', nulls)
}

export function desc<TRequires, TParameters>(
  expression: Expression<any, TRequires, TParameters, any>,
  nulls?: NullsOrder
) {
  return orderTerm(expression, 'DESC', nulls)
}

export function nullsFirst<TRequires, TParameters>(
  expression: Expression<any, TRequires, TParameters, any>
) {
  return orderTerm(expression, undefined, 'FIRST')
}

export function nullsLast<TRequires, TParameters>(
  expression: Expression<any, TRequires, TParameters, any>
) {
  return orderTerm(expression, undefined, 'LAST')
}

export interface OrderByClause<TRequires = never, TParameters = never>
  extends SelectClause<TRequires, TParameters> {
  readonly clauseKind: 'order-by'
  readonly terms: readonly OrderTerm<any, any>[]
}

export function orderBy<
  const TParts extends readonly (
    | Expression<any, any, any, any>
    | OrderTerm<any, any>
  )[],
>(
  ...parts: TParts
): OrderByClause<
  TParts[number] extends Fragment<any, infer TRequires, any>
    ? TRequires
    : never,
  TParts[number] extends Fragment<any, any, infer TParameters>
    ? TParameters
    : never
> {
  const terms = parts.map(part =>
    'orderKind' in part ? part : orderTerm(part)
  )
  return Object.assign(
    createClause('order-by', 'after-select', 80, context => {
      context.append('ORDER BY ')
      terms.forEach((term, index) => {
        if (index > 0) context.append(', ')
        context.render(term)
      })
    }),
    { clauseKind: 'order-by' as const, terms }
  ) as OrderByClause<any, any>
}
