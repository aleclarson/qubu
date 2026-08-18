import type { AnySource } from '../../schema/source.ts'
import type { ProvidedSourceIdentity } from '../../schema/source.ts'
import type { BooleanExpression } from '../../expressions/operators/comparison.ts'
import {
  type InheritedMetadata,
  type NullableSourceMeta,
} from '../../core/fragment.ts'
import { createClause, type SelectClause } from './types.ts'

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS' | 'NATURAL'

export interface JoinClause<
  TSource extends AnySource = AnySource,
  TMetadata = never,
> extends SelectClause<TMetadata> {
  readonly clauseKind: 'join'
  readonly joinType: JoinType
  readonly source: TSource
  readonly condition?: BooleanExpression<any>
}

function join<
  const TJoinType extends JoinType,
  TSource extends AnySource,
  TCondition extends BooleanExpression<any> | undefined,
>(
  joinType: TJoinType,
  source: TSource,
  condition?: TCondition
): JoinClause<
  TSource,
  | InheritedMetadata<TCondition>
  | (TJoinType extends 'LEFT'
      ? NullableSourceMeta<ProvidedSourceIdentity<TSource>>
      : never)
> {
  return Object.assign(
    createClause('join', 'after-select', 40, context => {
      context.append(`${joinType} JOIN `)
      context.render(source)
      if (condition) {
        context.append(' ON ')
        context.render(condition)
      }
    }),
    {
      clauseKind: 'join' as const,
      joinType,
      source,
      condition,
    }
  ) as JoinClause<
    TSource,
    | InheritedMetadata<TCondition>
    | (TJoinType extends 'LEFT'
        ? NullableSourceMeta<ProvidedSourceIdentity<TSource>>
        : never)
  >
}

export function innerJoin<
  TSource extends AnySource,
  TCondition extends BooleanExpression<any>,
>(source: TSource, condition: TCondition) {
  return join('INNER', source, condition)
}

export function leftJoin<
  TSource extends AnySource,
  TCondition extends BooleanExpression<any>,
>(source: TSource, condition: TCondition) {
  return join('LEFT', source, condition)
}

export function rightJoin<
  TSource extends AnySource,
  TCondition extends BooleanExpression<any>,
>(source: TSource, condition: TCondition) {
  return join('RIGHT', source, condition)
}

export function fullJoin<
  TSource extends AnySource,
  TCondition extends BooleanExpression<any>,
>(source: TSource, condition: TCondition) {
  return join('FULL', source, condition)
}

export function crossJoin<TSource extends AnySource>(
  source: TSource
): JoinClause<TSource, never> {
  return join<'CROSS', TSource, undefined>('CROSS', source)
}

export function naturalJoin<TSource extends AnySource>(
  source: TSource
): JoinClause<TSource, never> {
  return join<'NATURAL', TSource, undefined>('NATURAL', source)
}
