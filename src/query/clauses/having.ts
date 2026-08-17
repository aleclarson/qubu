import type { BooleanExpression } from '../../expressions/operators/comparison.ts'
import { createClause, type SelectClause } from './types.ts'

export interface HavingClause<TRequires = never, TParameters = never>
  extends SelectClause<TRequires, TParameters> {
  readonly clauseKind: 'having'
  readonly condition: BooleanExpression<TRequires, TParameters>
}

export function having<TRequires, TParameters>(
  condition: BooleanExpression<TRequires, TParameters>
): HavingClause<TRequires, TParameters> {
  return Object.assign(
    createClause('having', 'after-select', 70, context => {
      context.append('HAVING ')
      context.render(condition)
    }),
    { clauseKind: 'having' as const, condition }
  ) as HavingClause<TRequires, TParameters>
}
