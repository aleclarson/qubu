import type { BooleanExpression } from '../../expressions/operators/comparison.ts'
import type { InheritedMetadata } from '../../core/fragment.ts'
import { omit, type Omit } from '../omit.ts'
import { createClause, type SelectClause } from './types.ts'

export interface WhereClause<TMetadata = never>
  extends SelectClause<TMetadata> {
  readonly clauseKind: 'where'
  readonly condition: BooleanExpression<any>
}

type WhereComposition<TCondition extends BooleanExpression<any> | Omit> =
  TCondition extends Omit
    ? Omit
    : TCondition extends BooleanExpression<any>
      ? WhereClause<InheritedMetadata<TCondition>>
      : never

export function where<TCondition extends BooleanExpression<any> | Omit>(
  condition: TCondition
): WhereComposition<TCondition> {
  if (condition === omit) return omit as WhereComposition<TCondition>

  return Object.assign(
    createClause('where', 'after-select', 50, context => {
      context.append('WHERE ')
      context.render(condition)
    }),
    { clauseKind: 'where' as const, condition }
  ) as unknown as WhereComposition<TCondition>
}
