import type { Fragment } from '../../core/fragment.ts'
import type { AnyExpression, Expression } from '../../expressions/types.ts'
import { createClause, type SelectClause } from './types.ts'

export interface GroupByClause<TRequires = never, TParameters = never>
  extends SelectClause<TRequires, TParameters> {
  readonly clauseKind: 'group-by'
  readonly expressions: readonly AnyExpression[]
}

export function groupBy<
  const TExpressions extends readonly Expression<any, any, any, any>[],
>(
  ...expressions: TExpressions
): GroupByClause<
  TExpressions[number] extends Fragment<any, infer TRequires, any>
    ? TRequires
    : never,
  TExpressions[number] extends Fragment<any, any, infer TParameters>
    ? TParameters
    : never
> {
  return Object.assign(
    createClause('group-by', 'after-select', 60, context => {
      context.append('GROUP BY ')
      expressions.forEach((expression, index) => {
        if (index > 0) context.append(', ')
        context.render(expression)
      })
    }),
    { clauseKind: 'group-by' as const, expressions }
  ) as GroupByClause<any, any>
}
