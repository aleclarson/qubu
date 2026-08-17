import { createDialect } from '../core/dialect.ts'

/**
 * PostgreSQL's only core rendering difference is positional parameters.
 * PostgreSQL-specific expressions and clauses should remain separate modules.
 */
export function postgresDialect() {
  return createDialect({
    name: 'postgresql',
    placeholder: position => `$${position}`,
  })
}
