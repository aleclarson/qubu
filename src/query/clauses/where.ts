import type { BooleanExpression } from '../../expressions/operators/comparison.ts'
import type { InheritedMetadata } from '../../core/fragment.ts'
import { createClause, type SelectClause } from './types.ts'

export interface WhereClause<TMetadata = never>
  extends SelectClause<TMetadata> {
  readonly clauseKind: 'where'
  readonly condition: BooleanExpression<any>
}

export function where<TCondition extends BooleanExpression<any>>(
  condition: TCondition
): WhereClause<InheritedMetadata<TCondition>> {
  return Object.assign(
    createClause('where', 'after-select', 50, context => {
      context.append('WHERE ')
      context.render(condition)
    }),
    { clauseKind: 'where' as const, condition }
  ) as WhereClause<InheritedMetadata<TCondition>>
}
