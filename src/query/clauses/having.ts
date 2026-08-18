import type { BooleanExpression } from '../../expressions/operators/comparison.ts'
import type { InheritedMetadata } from '../../core/fragment.ts'
import { createClause, type SelectClause } from './types.ts'

export interface HavingClause<TMetadata = never>
  extends SelectClause<TMetadata> {
  readonly clauseKind: 'having'
  readonly condition: BooleanExpression<any>
}

export function having<TCondition extends BooleanExpression<any>>(
  condition: TCondition
): HavingClause<InheritedMetadata<TCondition>> {
  return Object.assign(
    createClause('having', 'after-select', 70, context => {
      context.append('HAVING ')
      context.render(condition)
    }),
    { clauseKind: 'having' as const, condition }
  ) as HavingClause<InheritedMetadata<TCondition>>
}
