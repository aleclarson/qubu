import type { AnyTable } from '../../schema/table.ts'
import {
  createMutation,
  type MutationClause,
  type MutationQuery,
  type MutationReturningClause,
  type MutationRow,
  type MutationSafetyValidation,
  type MutationScopeValidation,
  validateMutationClauses,
} from './types.ts'

export function deleteFrom<
  const TTable extends AnyTable,
  const TClauses extends readonly MutationClause[],
>(
  table: TTable,
  ...clauses: TClauses &
    MutationScopeValidation<TTable, TClauses> &
    MutationSafetyValidation<TClauses>
): MutationQuery<MutationRow<TClauses>, 'delete'> {
  const normalizedClauses = clauses as readonly MutationClause[]
  validateMutationClauses('DELETE', normalizedClauses)

  const whereClause = normalizedClauses.find(
    clause => clause.clauseKind === 'where'
  )
  const returningClause = normalizedClauses.find(
    clause => clause.clauseKind === 'returning'
  ) as MutationReturningClause | undefined
  const row = returningClause?.row ?? {}
  const query = createMutation('delete', row, context => {
    context.append('DELETE FROM ')
    context.render(table.reference)
    if (whereClause) {
      context.append(' ')
      context.render(whereClause)
    }
    if (returningClause) {
      context.append(' ')
      context.render(returningClause)
    }
  })

  return query as unknown as MutationQuery<MutationRow<TClauses>, 'delete'>
}

export const removeFrom = deleteFrom
