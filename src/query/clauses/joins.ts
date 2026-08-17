import type { AnySource } from '../../schema/source.ts'
import type { BooleanExpression } from '../../expressions/operators/comparison.ts'
import { createClause, type SelectClause } from './types.ts'

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS' | 'NATURAL'

export interface JoinClause<
  TSource extends AnySource = AnySource,
  TRequires = never,
  TParameters = never,
> extends SelectClause<TRequires, TParameters> {
  readonly clauseKind: 'join'
  readonly joinType: JoinType
  readonly source: TSource
  readonly condition?: BooleanExpression<TRequires, TParameters>
}

function join<
  const TJoinType extends JoinType,
  TSource extends AnySource,
  TRequires,
  TParameters,
>(
  joinType: TJoinType,
  source: TSource,
  condition?: BooleanExpression<TRequires, TParameters>
): JoinClause<TSource, TRequires, TParameters> {
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
  ) as JoinClause<TSource, TRequires, TParameters>
}

export function innerJoin<TSource extends AnySource, TRequires, TParameters>(
  source: TSource,
  condition: BooleanExpression<TRequires, TParameters>
) {
  return join('INNER', source, condition)
}

export function leftJoin<TSource extends AnySource, TRequires, TParameters>(
  source: TSource,
  condition: BooleanExpression<TRequires, TParameters>
) {
  return join('LEFT', source, condition)
}

export function rightJoin<TSource extends AnySource, TRequires, TParameters>(
  source: TSource,
  condition: BooleanExpression<TRequires, TParameters>
) {
  return join('RIGHT', source, condition)
}

export function fullJoin<TSource extends AnySource, TRequires, TParameters>(
  source: TSource,
  condition: BooleanExpression<TRequires, TParameters>
) {
  return join('FULL', source, condition)
}

export function crossJoin<TSource extends AnySource>(
  source: TSource
): JoinClause<TSource, never, never> {
  return join<'CROSS', TSource, never, never>('CROSS', source)
}

export function naturalJoin<TSource extends AnySource>(
  source: TSource
): JoinClause<TSource, never, never> {
  return join<'NATURAL', TSource, never, never>('NATURAL', source)
}
