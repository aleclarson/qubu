import type { Expression, ExpressionKind } from '../../types.ts'

export type BooleanExpression<
  TRequires = never,
  TParameters = never,
  TKind extends ExpressionKind = 'operator' | 'subquery',
> = Expression<boolean, TRequires, TParameters, TKind>
