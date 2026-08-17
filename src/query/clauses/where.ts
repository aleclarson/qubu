import type { BooleanExpression } from '../../expressions/operators/comparison.ts'
import { createClause, type SelectClause } from './types.ts'

export interface WhereClause<TRequires = never, TParameters = never>
  extends SelectClause<TRequires, TParameters> {
  readonly clauseKind: 'where'
  readonly condition: BooleanExpression<TRequires, TParameters>
}

export function where<TRequires, TParameters>(
  condition: BooleanExpression<TRequires, TParameters>
): WhereClause<TRequires, TParameters> {
  return Object.assign(
    createClause('where', 'after-select', 50, context => {
      context.append('WHERE ')
      context.render(condition)
    }),
    { clauseKind: 'where' as const, condition }
  ) as WhereClause<TRequires, TParameters>
}
