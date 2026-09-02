import type { RenderContext, RequiresOf, RequiresOuterOf } from "../../core/fragment.ts"
import { identifier } from "../../core/primitives/identifier.ts"
import { isExpression, type ExpressionWithOutput } from "../../expressions/types.ts"
import { columnSqlType, encodeColumnParameter, type ColumnStorage } from "../../schema/column.ts"
import type { SourceIdentity } from "../../schema/source.ts"
import type { AnyTable, TableUpdateInput } from "../../schema/table.ts"
import { queryValidationError, type QueryTypeValidation } from "../errors.ts"
import { omit, type Omit } from "../omit.ts"
import {
  createMutation,
  type MutationClause,
  type MutationQuery,
  type MutationReturningClause,
  type MutationRow,
  type MutationSafetyValidation,
  type MutationSqlTypes,
  type MutationMetadata,
  validateMutationClauses,
  validateMutationWithClauses,
} from "./types.ts"
import type { UpdateFromClause, UpdateFromScope } from "./update-from.ts"

/** A value, target-compatible expression, or explicitly omitted update field. */
export type UpdateAssignmentValue<T> = T | ExpressionWithOutput<T> | Omit

/** Writable table fields accepted by {@link update}. */
export type UpdateAssignments<TTable extends AnyTable> = {
  -readonly [K in keyof TableUpdateInput<TTable["definitions"]>]?: UpdateAssignmentValue<
    TableUpdateInput<TTable["definitions"]>[K]
  >
}

type InvalidUpdateAssignments<TTable extends AnyTable, TAssignments> =
  TAssignments extends UpdateAssignments<TTable>
    ? Exclude<keyof TAssignments, keyof UpdateAssignments<TTable>> extends never
      ? unknown
      : QueryTypeValidation<
          "invalid-update",
          "update.assignments",
          "Use only columns declared by the update table.",
          Exclude<keyof TAssignments, keyof UpdateAssignments<TTable>>
        >
    : QueryTypeValidation<
        "invalid-update",
        "update.assignments",
        "Provide values or expressions matching the update table columns.",
        TAssignments
      >

type AssignmentScopeValidation<
  TTable extends AnyTable,
  TAssignments,
  TClauses extends readonly UpdateClause[],
> = [
  Exclude<
    RequiresOf<TAssignments extends object ? TAssignments[keyof TAssignments] : never>,
    SourceIdentity<TTable> | UpdateFromScope<TClauses[number]>
  >,
] extends [never]
  ? unknown
  : QueryTypeValidation<
      "missing-source",
      "update.assignments",
      "Use expressions scoped to the update table or an updateFrom() source.",
      Exclude<
        RequiresOf<TAssignments extends object ? TAssignments[keyof TAssignments] : never>,
        SourceIdentity<TTable> | UpdateFromScope<TClauses[number]>
      >
    >

type UpdateClause = MutationClause | UpdateFromClause

type UpdateScopeValidation<TTable extends AnyTable, TClauses extends readonly UpdateClause[]> = [
  Exclude<RequiresOf<TClauses[number]>, SourceIdentity<TTable> | UpdateFromScope<TClauses[number]>>,
] extends [never]
  ? unknown
  : QueryTypeValidation<
      "missing-source",
      "mutation.scope",
      "Use clauses that reference the update table or an updateFrom() source.",
      Exclude<
        RequiresOf<TClauses[number]>,
        SourceIdentity<TTable> | UpdateFromScope<TClauses[number]>
      >
    >

type UpdateFromSourceValidation<TClauses extends readonly UpdateClause[]> = [
  Exclude<
    RequiresOuterOf<Extract<TClauses[number], UpdateFromClause>>,
    UpdateFromScope<TClauses[number]>
  >,
] extends [never]
  ? unknown
  : QueryTypeValidation<
      "missing-source",
      "update.from",
      "Use FROM sources whose outer requirements are provided by another updateFrom() source.",
      Exclude<
        RequiresOuterOf<Extract<TClauses[number], UpdateFromClause>>,
        UpdateFromScope<TClauses[number]>
      >
    >

export function update<
  const TTable extends AnyTable,
  const TAssignments extends object,
  const TClauses extends readonly UpdateClause[],
>(
  table: TTable,
  assignments: TAssignments &
    InvalidUpdateAssignments<TTable, TAssignments> &
    AssignmentScopeValidation<TTable, TAssignments, TClauses>,
  ...clauses: TClauses &
    UpdateScopeValidation<TTable, TClauses> &
    UpdateFromSourceValidation<TClauses> &
    MutationSafetyValidation<TClauses>
): MutationQuery<{
  readonly row: MutationRow<TClauses>
  readonly kind: "update"
  readonly metadata: MutationMetadata<
    TClauses[number] | (TAssignments extends object ? TAssignments[keyof TAssignments] : never)
  >
  readonly sqlTypes: MutationSqlTypes<TClauses>
}> {
  const normalizedClauses = clauses as readonly UpdateClause[]

  validateMutationClauses("UPDATE", normalizedClauses)
  validateMutationWithClauses("UPDATE", normalizedClauses)
  const entries = validateUpdate(table, assignments)

  const whereClause = normalizedClauses.find((clause) => clause.clauseKind === "where")
  const withClause = normalizedClauses.find((clause) => clause.clauseKind === "with")
  const fromClause = normalizedClauses.find((clause) => clause.clauseKind === "update-from")
  const returningClause = normalizedClauses.find((clause) => clause.clauseKind === "returning") as
    | MutationReturningClause
    | undefined
  const row = returningClause?.row ?? {}
  const resultShape = returningClause?.resultShape ?? { fields: [] }
  const query = createMutation("update", row, resultShape, (context) => {
    if (withClause) {
      context.render(withClause)
      context.append(" ")
    }

    context.append("UPDATE ")
    context.render(table.reference)
    context.append(" SET ")

    entries.forEach(([columnName, value], index) => {
      if (index > 0) {
        context.append(", ")
      }

      context.render(identifier(table.sqlNames[columnName] ?? columnName))
      context.append(" = ")
      renderAssignmentValue(context, value, table.definitions[columnName])
    })

    if (fromClause) {
      context.append(" ")
      context.render(fromClause)
    }

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
    readonly kind: "update"
    readonly metadata: MutationMetadata<
      TClauses[number] | (TAssignments extends object ? TAssignments[keyof TAssignments] : never)
    >
    readonly sqlTypes: MutationSqlTypes<TClauses>
  }>
}

function renderAssignmentValue(
  context: RenderContext,
  value: unknown,
  definition: {
    readonly parameterEncoder?: (value: unknown) => unknown
    readonly storage?: ColumnStorage
  },
) {
  if (isExpression(value)) {
    context.render(value)
  } else {
    context.parameter(encodeColumnParameter(definition, value), columnSqlType(definition))
  }
}

function validateUpdate(table: AnyTable, assignments: object) {
  const definitions = table.definitions as Record<string, { generated?: boolean }>
  const entries = Object.entries(assignments).filter(([, value]) => value !== omit)

  if (entries.length === 0) {
    throw queryValidationError({
      code: "invalid-update",
      context: "update.assignments",
      path: ["assignments"],
      message: "UPDATE requires at least one assignment",
      hint: "Provide at least one writable column, or remove the update.",
    })
  }

  for (const [columnName] of entries) {
    const definition = definitions[columnName]

    if (!definition) {
      throw queryValidationError({
        code: "invalid-update",
        context: "update.assignments",
        path: ["assignments", columnName],
        message: `Unknown update column "${columnName}"`,
        hint: "Use a column declared by the update table.",
      })
    }

    if (definition.generated) {
      throw queryValidationError({
        code: "invalid-update",
        context: "update.assignments",
        path: ["assignments", columnName],
        message: `Generated column "${columnName}" cannot be updated`,
        hint: "Remove the generated column from the assignments.",
      })
    }
  }

  return entries
}
