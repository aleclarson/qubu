import { identifier } from '../../core/primitives/identifier.ts'
import {
  isExpression,
  type AnyExpression,
  type Expression,
} from '../../expressions/types.ts'
import type { ParametersOf, RequiresOf } from '../../core/fragment.ts'
import type { SourceIdentity } from '../../schema/source.ts'
import type { AnyTable, TableUpdateInput } from '../../schema/table.ts'
import {
  createMutation,
  type MutationClause,
  type MutationParameters,
  type MutationQuery,
  type MutationReturningClause,
  type MutationRow,
  type MutationSafetyValidation,
  type MutationScopeValidation,
  validateMutationClauses,
} from './types.ts'

export type UpdateAssignmentValue<T> = T | Expression<T, any, any, any>

export type UpdateAssignments<TTable extends AnyTable> = {
  -readonly [K in keyof TableUpdateInput<
    TTable['definitions']
  >]?: UpdateAssignmentValue<TableUpdateInput<TTable['definitions']>[K]>
}

type InvalidUpdateAssignments<TTable extends AnyTable, TAssignments> =
  TAssignments extends UpdateAssignments<TTable>
    ? Exclude<keyof TAssignments, keyof UpdateAssignments<TTable>> extends never
      ? unknown
      : {
          readonly __unknown_update_columns__: Exclude<
            keyof TAssignments,
            keyof UpdateAssignments<TTable>
          >
        }
    : { readonly __invalid_update_assignments__: TAssignments }

type AssignmentParameters<TAssignments> = TAssignments extends object
  ? TAssignments[keyof TAssignments] extends infer TValue
    ? TValue extends AnyExpression
      ? ParametersOf<TValue>
      : TValue
    : never
  : never

type AssignmentScopeValidation<TTable extends AnyTable, TAssignments> = [
  Exclude<
    RequiresOf<
      TAssignments extends object ? TAssignments[keyof TAssignments] : never
    >,
    SourceIdentity<TTable>
  >,
] extends [never]
  ? unknown
  : {
      readonly __missing_sources__: Exclude<
        RequiresOf<
          TAssignments extends object ? TAssignments[keyof TAssignments] : never
        >,
        SourceIdentity<TTable>
      >
    }

export function update<
  const TTable extends AnyTable,
  const TAssignments extends object,
  const TClauses extends readonly MutationClause[],
>(
  table: TTable,
  assignments: TAssignments &
    InvalidUpdateAssignments<TTable, TAssignments> &
    AssignmentScopeValidation<TTable, TAssignments>,
  ...clauses: TClauses &
    MutationScopeValidation<TTable, TClauses> &
    MutationSafetyValidation<TClauses>
): MutationQuery<
  MutationRow<TClauses>,
  AssignmentParameters<TAssignments> | MutationParameters<TClauses>,
  'update'
> {
  const normalizedClauses = clauses as readonly MutationClause[]
  validateMutationClauses('UPDATE', normalizedClauses)
  validateUpdate(table, assignments)

  const whereClause = normalizedClauses.find(
    clause => clause.clauseKind === 'where'
  )
  const returningClause = normalizedClauses.find(
    clause => clause.clauseKind === 'returning'
  ) as MutationReturningClause | undefined
  const row = returningClause?.row ?? {}
  const query = createMutation('update', row, context => {
    context.append('UPDATE ')
    context.render(table.reference)
    context.append(' SET ')

    const entries = Object.entries(assignments)
    entries.forEach(([columnName, value], index) => {
      if (index > 0) context.append(', ')
      context.render(identifier(columnName))
      context.append(' = ')
      renderAssignmentValue(context, value)
    })

    if (whereClause) {
      context.append(' ')
      context.render(whereClause)
    }
    if (returningClause) {
      context.append(' ')
      context.render(returningClause)
    }
  })

  return query as unknown as MutationQuery<
    MutationRow<TClauses>,
    AssignmentParameters<TAssignments> | MutationParameters<TClauses>,
    'update'
  >
}

function renderAssignmentValue(
  context: Parameters<AnyExpression['render']>[0],
  value: unknown
) {
  if (isExpression(value)) context.render(value)
  else context.parameter(value)
}

function validateUpdate(table: AnyTable, assignments: object) {
  const definitions = table.definitions as Record<
    string,
    { generated?: boolean }
  >
  const entries = Object.entries(assignments)
  if (entries.length === 0)
    throw new Error('UPDATE requires at least one assignment')

  for (const [columnName] of entries) {
    const definition = definitions[columnName]
    if (!definition) throw new Error(`Unknown update column "${columnName}"`)
    if (definition.generated) {
      throw new Error(`Generated column "${columnName}" cannot be updated`)
    }
  }
}
