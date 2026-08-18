import { syntax } from '../core/primitives/syntax.ts'
import { makeExpression, type Expression } from './types.ts'
import type { ExpressionMeta, ResultMeta } from '../core/fragment.ts'

/** Explicit escape hatch for syntax the standard primitives do not model. */
export function unsafeExpression<T = unknown>(
  sql: string
): Expression<ResultMeta<T> | ExpressionMeta<never>, 'unsafe'> {
  return makeExpression<ResultMeta<T> | ExpressionMeta<never>, 'unsafe'>(
    'unsafe',
    context => context.render(syntax(sql))
  )
}
