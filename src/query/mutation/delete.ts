import type { AnyTable } from "../../schema/table.ts"
import {
  createMutation,
  type MutationClause,
  type MutationQuery,
  type MutationReturningClause,
  type MutationRow,
  type MutationSafetyValidation,
  type MutationScopeValidation,
  type MutationMetadata,
  type MutationSqlTypes,
  validateMutationClauses,
  validateMutationWithClauses,
} from "./types.ts"

export function deleteFrom<
  const TTable extends AnyTable,
  const TClauses extends readonly MutationClause[],
>(
  table: TTable,
  ...clauses: TClauses &
    MutationScopeValidation<TTable, TClauses> &
    MutationSafetyValidation<TClauses>
): MutationQuery<{
  readonly row: MutationRow<TClauses>
  readonly kind: "delete"
  readonly metadata: MutationMetadata<TClauses[number]>
  readonly sqlTypes: MutationSqlTypes<TClauses>
}> {
  const normalizedClauses = clauses as readonly MutationClause[]

  validateMutationClauses("DELETE", normalizedClauses)
  validateMutationWithClauses("DELETE", normalizedClauses)

  const whereClause = normalizedClauses.find((clause) => clause.clauseKind === "where")
  const withClause = normalizedClauses.find((clause) => clause.clauseKind === "with")
  const returningClause = normalizedClauses.find((clause) => clause.clauseKind === "returning") as
    | MutationReturningClause
    | undefined
  const row = returningClause?.row ?? {}
  const resultShape = returningClause?.resultShape ?? { fields: [] }
  const query = createMutation("delete", row, resultShape, (context) => {
    if (withClause) {
      context.render(withClause)
      context.append(" ")
    }

    context.append("DELETE FROM ")
    context.render(table.reference)
    if (whereClause) {
      context.append(" ")
      context.render(whereClause)
    }

    if (returningClause) {
      context.append(" ")
      context.render(returningClause)
    }
  })

  return query as unknown as MutationQuery<{
    readonly row: MutationRow<TClauses>
    readonly kind: "delete"
    readonly metadata: MutationMetadata<TClauses[number]>
    readonly sqlTypes: MutationSqlTypes<TClauses>
  }>
}
