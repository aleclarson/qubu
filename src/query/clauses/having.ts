import type { BooleanExpression } from '../../expressions/operators/comparison.ts'
import type { InheritedMetadata } from '../../core/fragment.ts'
import { omit, type Omit } from '../omit.ts'
import { createClause, type SelectClause } from './types.ts'

export interface HavingClause<TMetadata = never>
  extends SelectClause<TMetadata> {
  readonly clauseKind: 'having'
  readonly condition: BooleanExpression<any>
}

type HavingComposition<TCondition extends BooleanExpression<any> | Omit> =
  TCondition extends Omit
    ? Omit
    : TCondition extends BooleanExpression<any>
      ? HavingClause<InheritedMetadata<TCondition>>
      : never

export function having<TCondition extends BooleanExpression<any> | Omit>(
  condition: TCondition
): HavingComposition<TCondition> {
  if (condition === omit) return omit as HavingComposition<TCondition>

  return Object.assign(
    createClause('having', 'after-select', 70, context => {
      context.append('HAVING ')
      context.render(condition)
    }),
    { clauseKind: 'having' as const, condition }
  ) as unknown as HavingComposition<TCondition>
}
