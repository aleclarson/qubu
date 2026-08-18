import type { Expression, ExpressionKind } from '../../types.ts'
import type { ResultMeta } from '../../../core/fragment.ts'

export type BooleanExpression<
  TMetadata = never,
  TKind extends ExpressionKind = 'operator' | 'subquery',
> = Expression<ResultMeta<boolean, unknown> | TMetadata, TKind>
