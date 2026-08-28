import { identifier } from '../../core/primitives/identifier.ts'
import {
  isExpression,
  type ExpressionWithOutput,
} from '../../expressions/types.ts'
import type { RenderContext, RequiresOf } from '../../core/fragment.ts'
import type { SourceIdentity } from '../../schema/source.ts'
import type { AnyTable, TableUpdateInput } from '../../schema/table.ts'
import { omit, type Omit } from '../omit.ts'
import { queryValidationError, type QueryTypeValidation } from '../errors.ts'
import {
  createMutation,
  type MutationClause,
  type MutationQuery,
  type MutationReturningClause,
  type MutationRow,
  type MutationSafetyValidation,
  type MutationScopeValidation,
  type MutationSqlTypes,
  type MutationCapabilityMetadata,
  validateMutationClauses,
} from './types.ts'

/** A value, target-compatible expression, or explicitly omitted update field. */
export type UpdateAssignmentValue<T> = T | ExpressionWithOutput<T> | Omit

/** Writable table fields accepted by {@link update}. */
export type UpdateAssignments<TTable extends AnyTable> = {
  -readonly [K in keyof TableUpdateInput<
    TTable['definitions']
  >]?: UpdateAssignmentValue<TableUpdateInput<TTable['definitions']>[K]>
}

type InvalidUpdateAssignments<TTable extends AnyTable, TAssignments> =
  TAssignments extends UpdateAssignments<TTable>
    ? Exclude<keyof TAssignments, keyof UpdateAssignments<TTable>> extends never
      ? unknown
      : QueryTypeValidation<
          'invalid-update',
          'update.assignments',
          'Use only columns declared by the update table.',
          Exclude<keyof TAssignments, keyof UpdateAssignments<TTable>>
        >
    : QueryTypeValidation<
        'invalid-update',
        'update.assignments',
        'Provide values or expressions matching the update table columns.',
        TAssignments
      >

type AssignmentScopeValidation<TTable extends AnyTable, TAssignments> = [
  Exclude<
    RequiresOf<
      TAssignments extends object ? TAssignments[keyof TAssignments] : never
    >,
    SourceIdentity<TTable>
  >,
] extends [never]
  ? unknown
  : QueryTypeValidation<
      'missing-source',
      'update.assignments',
      'Use expressions scoped to the update table.',
      Exclude<
        RequiresOf<
          TAssignments extends object ? TAssignments[keyof TAssignments] : never
        >,
        SourceIdentity<TTable>
      >
    >

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
  'update',
  MutationCapabilityMetadata<
    | TClauses[number]
    | (TAssignments extends object ? TAssignments[keyof TAssignments] : never)
  >,
  MutationSqlTypes<TClauses>
> {
  const normalizedClauses = clauses as readonly MutationClause[]
  validateMutationClauses('UPDATE', normalizedClauses)
  const entries = validateUpdate(table, assignments)

  const whereClause = normalizedClauses.find(
    clause => clause.clauseKind === 'where'
  )
  const returningClause = normalizedClauses.find(
    clause => clause.clauseKind === 'returning'
  ) as MutationReturningClause | undefined
  const row = returningClause?.row ?? {}
  const resultShape = returningClause?.resultShape ?? { fields: [] }
  const query = createMutation('update', row, resultShape, context => {
    context.append('UPDATE ')
    context.render(table.reference)
    context.append(' SET ')

    entries.forEach(([columnName, value], index) => {
      if (index > 0) context.append(', ')
      context.render(identifier(table.sqlNames[columnName] ?? columnName))
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
    'update',
    MutationCapabilityMetadata<
      | TClauses[number]
      | (TAssignments extends object ? TAssignments[keyof TAssignments] : never)
    >,
    MutationSqlTypes<TClauses>
  >
}

function renderAssignmentValue(context: RenderContext, value: unknown) {
  if (isExpression(value)) context.render(value)
  else context.parameter(value)
}

function validateUpdate(table: AnyTable, assignments: object) {
  const definitions = table.definitions as Record<
    string,
    { generated?: boolean }
  >
  const entries = Object.entries(assignments).filter(
    ([, value]) => value !== omit
  )
  if (entries.length === 0)
    throw queryValidationError({
      code: 'invalid-update',
      context: 'update.assignments',
      path: ['assignments'],
      message: 'UPDATE requires at least one assignment',
      hint: 'Provide at least one writable column, or remove the update.',
    })

  for (const [columnName] of entries) {
    const definition = definitions[columnName]
    if (!definition) {
      throw queryValidationError({
        code: 'invalid-update',
        context: 'update.assignments',
        path: ['assignments', columnName],
        message: `Unknown update column "${columnName}"`,
        hint: 'Use a column declared by the update table.',
      })
    }
    if (definition.generated) {
      throw queryValidationError({
        code: 'invalid-update',
        context: 'update.assignments',
        path: ['assignments', columnName],
        message: `Generated column "${columnName}" cannot be updated`,
        hint: 'Remove the generated column from the assignments.',
      })
    }
  }

  return entries
}
