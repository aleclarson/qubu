import { syntax } from '../core/primitives/syntax.ts'
import { makeExpression, type Expression } from './types.ts'

/** Explicit escape hatch for syntax the standard primitives do not model. */
export function unsafeExpression<T = unknown>(
  sql: string
): Expression<T, never, never, 'unsafe'> {
  return makeExpression('unsafe', context => context.render(syntax(sql)))
}
