import type { ResultMeta } from "../../../core/fragment.ts"
import type { AnySqlType } from "../../../core/sql-types.ts"
import type { Expression, ExpressionKind } from "../../types.ts"

export type BooleanExpression<
  TMetadata = never,
  TKind extends ExpressionKind = ExpressionKind,
> = Expression<ResultMeta<boolean, unknown, AnySqlType> | TMetadata, TKind>
