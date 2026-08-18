import { type Fragment, type InheritedMetadata } from '../../core/fragment.ts'
import { makeExpression, type AnyExpression } from '../../expressions/types.ts'
import { createClause, type SelectClause } from './types.ts'

export type OrderDirection = 'ASC' | 'DESC'
export type NullsOrder = 'FIRST' | 'LAST'

export interface OrderTerm<TMetadata = never> extends Fragment<TMetadata> {
  readonly orderKind: 'term'
  readonly expression: AnyExpression
  readonly direction?: OrderDirection
  readonly nulls?: NullsOrder
}

function orderTerm<TExpression extends AnyExpression>(
  expression: TExpression,
  direction?: OrderDirection,
  nulls?: NullsOrder
): OrderTerm<InheritedMetadata<TExpression>> {
  const base = makeExpression<InheritedMetadata<TExpression>, 'operator'>(
    'operator',
    context => {
      context.render(expression)
      if (direction) context.append(` ${direction}`)
      if (nulls) context.append(` NULLS ${nulls}`)
    }
  )
  return Object.freeze({
    ...base,
    orderKind: 'term' as const,
    expression,
    direction,
    nulls,
  }) as OrderTerm<InheritedMetadata<TExpression>>
}

export function order<TExpression extends AnyExpression>(
  expression: TExpression,
  direction?: OrderDirection,
  nulls?: NullsOrder
) {
  return orderTerm(expression, direction, nulls)
}

export function asc<TExpression extends AnyExpression>(
  expression: TExpression,
  nulls?: NullsOrder
) {
  return orderTerm(expression, 'ASC', nulls)
}

export function desc<TExpression extends AnyExpression>(
  expression: TExpression,
  nulls?: NullsOrder
) {
  return orderTerm(expression, 'DESC', nulls)
}

export function nullsFirst<TExpression extends AnyExpression>(
  expression: TExpression
) {
  return orderTerm(expression, undefined, 'FIRST')
}

export function nullsLast<TExpression extends AnyExpression>(
  expression: TExpression
) {
  return orderTerm(expression, undefined, 'LAST')
}

export interface OrderByClause<TMetadata = never>
  extends SelectClause<TMetadata> {
  readonly clauseKind: 'order-by'
  readonly terms: readonly OrderTerm<any>[]
}

export function orderBy<
  const TParts extends readonly (AnyExpression | OrderTerm<any>)[],
>(...parts: TParts): OrderByClause<InheritedMetadata<TParts[number]>> {
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
  ) as OrderByClause<InheritedMetadata<TParts[number]>>
}
