import type { AnySelectClause } from '../clauses/types.ts'

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
  ])
  const seen = new Set<string>()

  for (const clause of clauses) {
    if (!singletonKinds.has(clause.clauseKind)) continue
    if (seen.has(clause.clauseKind)) {
      throw new Error(
        `Only one ${clause.clauseKind} clause is allowed; compose repeated conditions or terms explicitly`
      )
    }
    seen.add(clause.clauseKind)
  }
}
