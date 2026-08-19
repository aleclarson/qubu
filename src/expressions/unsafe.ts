import { syntax } from '../core/primitives/syntax.ts'
import { makeExpression, type Expression } from './types.ts'
import type { ExpressionMeta, ResultMeta } from '../core/fragment.ts'
import type { AnySqlType, SqlUnknown } from '../core/sql-types.ts'

/** Explicit escape hatch for syntax the standard primitives do not model. */
export function unsafeExpression<
  T = unknown,
  TSqlType extends AnySqlType = SqlUnknown,
>(
  sql: string
): Expression<
  ResultMeta<T, never, TSqlType> | ExpressionMeta<never>,
  'unsafe'
> {
  return makeExpression<
    ResultMeta<T, never, TSqlType> | ExpressionMeta<never>,
    'unsafe'
  >('unsafe', context => context.render(syntax(sql)))
}
