import { createDialect, type PaginationPart } from '../core/dialect.ts'
import type { RenderContext } from '../core/fragment.ts'
import {
  comparison,
  type ComparisonValidation,
} from '../expressions/operators/comparison/relational.ts'
import type { Operand } from '../expressions/operators/shared.ts'
import {
  withDialectCapability,
  type ExpressionWithOutput,
} from '../expressions/types.ts'
import { postgresJson } from './json.ts'

const postgresPagination = {
  render(context: RenderContext, parts: readonly PaginationPart[]) {
    const ordered = [...parts].sort((left, right) => {
      const leftOrder = left.kind === 'fetch' ? 0 : 1
      const rightOrder = right.kind === 'fetch' ? 0 : 1
      return leftOrder - rightOrder
    })

    ordered.forEach((part, index) => {
      if (index > 0) context.append(' ')
      context.append(part.kind === 'fetch' ? 'LIMIT ' : 'OFFSET ')
      context.parameter(part.rows)
    })
  },
}

/**
 * PostgreSQL's only core rendering difference is positional parameters.
 * PostgreSQL-specific expressions and clauses should remain separate modules.
 */
export function postgresDialect() {
  return createDialect({
    name: 'postgresql',
    placeholder: position => `$${position}`,
    pagination: postgresPagination,
    capabilities: ['ilike'],
    json: postgresJson,
  })
}

/** PostgreSQL's case-insensitive pattern-match operator. */
export function ilike<
  TLeft extends ExpressionWithOutput<string>,
  R extends Operand<string>,
>(left: TLeft & ComparisonValidation<TLeft, R, 'ILIKE'>, pattern: R) {
  return withDialectCapability(comparison('ILIKE', left, pattern), 'ilike')
}
