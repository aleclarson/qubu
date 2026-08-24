import type { AnySelectClause } from '../clauses/types.ts'
import { queryValidationError } from '../errors.ts'

export function validateClauses(clauses: readonly AnySelectClause[]) {
  const singletonKinds = new Set([
    'distinct',
    'from',
    'where',
    'group-by',
    'having',
    'order-by',
    'offset',
    'fetch',
    'row-lock',
  ])
  const seen = new Set<string>()

  for (const [index, clause] of clauses.entries()) {
    if (!singletonKinds.has(clause.clauseKind)) continue
    if (seen.has(clause.clauseKind)) {
      const hint =
        clause.clauseKind === 'where' || clause.clauseKind === 'having'
          ? 'Compose repeated conditions with and() or or().'
          : clause.clauseKind === 'order-by'
            ? 'Combine terms in one orderBy() call.'
            : clause.clauseKind === 'row-lock'
              ? 'Combine the mode and wait policy in one rowLock() call.'
              : 'Keep one clause of this kind.'
      throw queryValidationError({
        code: 'duplicate-clause',
        context: 'select.clauses',
        path: ['clauses', index],
        message: `Only one ${clause.clauseKind} clause is allowed`,
        hint,
      })
    }
    seen.add(clause.clauseKind)
  }
}
