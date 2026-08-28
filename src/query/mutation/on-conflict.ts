import { assertDialectCapability } from '../../core/dialect.ts'
import {
  fragment,
  type CapabilityMetadataOf,
  type Fragment,
  type RequiresCapabilityMeta,
  type RequiresOf,
  type RenderContext,
} from '../../core/fragment.ts'
import { identifier } from '../../core/primitives/identifier.ts'
import { isExpression } from '../../expressions/types.ts'
import type { WhereClause } from '../clauses/where.ts'
import { omit } from '../omit.ts'
import type { QueryTypeValidation } from '../errors.ts'
import { columnResultValue } from '../../schema/column.ts'
import { queryValidationError } from '../errors.ts'
import type {
  KeyConstraint,
  SourceConstraintsRecord,
} from '../../schema/constraints.ts'
import type { AnyTable } from '../../schema/table.ts'
import {
  createColumnReference,
  type ColumnReference,
} from '../../expressions/column.ts'
import {
  createSource,
  exposeColumns,
  type Source,
  type SourceColumns,
  type SourceIdentity,
  type SourceRow,
  type SourceSqlTypeMap,
  type SourceSqlTypes,
} from '../../schema/source.ts'
import type { MutationReturningClause } from './types.ts'
import type { UpdateAssignments } from './update.ts'

export type ExcludedIdentity<TTableIdentity> = {
  readonly sourceKind: 'excluded'
  readonly table: TTableIdentity
}

export type ExcludedSource<TTable extends AnyTable> = Source<{
  readonly identity: ExcludedIdentity<SourceIdentity<TTable>>
  readonly row: SourceRow<TTable>
  readonly sqlTypes: ExcludedSqlTypes<TTable>
}> &
  SourceColumns<
    SourceRow<TTable>,
    ExcludedIdentity<SourceIdentity<TTable>>,
    ExcludedSqlTypes<TTable>
  >

type ExcludedSqlTypes<TTable extends AnyTable> = SourceSqlTypeMap<TTable> &
  SourceSqlTypes<SourceRow<TTable>>

/** Columns from the proposed INSERT row, available inside DO UPDATE. */
export function excluded<const TTable extends AnyTable>(
  table: TTable
): ExcludedSource<TTable> {
  type TIdentity = ExcludedIdentity<SourceIdentity<TTable>>
  type TRow = SourceRow<TTable>
  type TSqlTypes = ExcludedSqlTypes<TTable>

  const reference = fragment<never>(context => {
    assertDialectCapability(context.dialect, 'on-conflict')
    context.append('excluded')
  })
  const source = createSource<TIdentity, TRow, never, TSqlTypes>(
    'excluded',
    context => context.render(reference),
    reference
  )
  const columns = Object.fromEntries(
    Object.keys(table.definitions).map(fieldName => [
      fieldName,
      createColumnReference(
        table.sqlNames[fieldName] ?? fieldName,
        reference,
        fieldName,
        columnResultValue(table.definitions[fieldName])
      ) as ColumnReference<string, any>,
    ])
  ) as SourceColumns<TRow, TIdentity, TSqlTypes>

  Object.assign(source, { columns })
  exposeColumns(source, columns as Record<string, unknown>)
  return source as ExcludedSource<TTable>
}

export interface DoNothingAction {
  readonly actionKind: 'do-nothing'
}

export interface DoUpdateAction<
  TAssignments extends object = object,
  TWhere extends WhereClause<any> | undefined = WhereClause<any> | undefined,
> {
  readonly actionKind: 'do-update'
  readonly assignments: TAssignments
  readonly where: TWhere
}

export type ConflictAction = DoNothingAction | DoUpdateAction<any, any>

export function doNothing(): DoNothingAction {
  return Object.freeze({ actionKind: 'do-nothing' as const })
}

export function doUpdate<const TAssignments extends object>(
  assignments: TAssignments
): DoUpdateAction<TAssignments, undefined>
export function doUpdate<
  const TAssignments extends object,
  const TWhere extends WhereClause<any>,
>(
  assignments: TAssignments,
  whereClause: TWhere
): DoUpdateAction<TAssignments, TWhere>
export function doUpdate(
  assignments: object,
  whereClause?: WhereClause<any>
): DoUpdateAction<object, WhereClause<any> | undefined> {
  return Object.freeze({
    actionKind: 'do-update' as const,
    assignments,
    where: whereClause,
  })
}

type TableConstraints<TTable extends AnyTable> = TTable extends {
  readonly constraints: infer TConstraints extends SourceConstraintsRecord
}
  ? TConstraints
  : never

type TableKeyConstraint<TTable extends AnyTable> = Extract<
  TableConstraints<TTable>[keyof TableConstraints<TTable>],
  KeyConstraint
>

/** A declared primary or non-null unique key used as an upsert target. */
export type ConflictTarget<TTable extends AnyTable = AnyTable> =
  TableKeyConstraint<TTable>

type ConflictSources<TTable extends AnyTable> =
  | SourceIdentity<TTable>
  | ExcludedIdentity<SourceIdentity<TTable>>

type ConflictAssignmentValidation<TTable extends AnyTable, TAssignments> =
  TAssignments extends UpdateAssignments<TTable>
    ? Exclude<keyof TAssignments, keyof UpdateAssignments<TTable>> extends never
      ? [
          Exclude<
            RequiresOf<TAssignments[keyof TAssignments]>,
            ConflictSources<TTable>
          >,
        ] extends [never]
        ? unknown
        : QueryTypeValidation<
            'missing-source',
            'upsert.update.assignments',
            'Use expressions scoped to the target table or excluded row.',
            Exclude<
              RequiresOf<TAssignments[keyof TAssignments]>,
              ConflictSources<TTable>
            >
          >
      : QueryTypeValidation<
          'invalid-update',
          'upsert.update.assignments',
          'Use only writable columns declared by the target table.',
          Exclude<keyof TAssignments, keyof UpdateAssignments<TTable>>
        >
    : QueryTypeValidation<
        'invalid-update',
        'upsert.update.assignments',
        'Provide values or expressions matching the target table update columns.',
        TAssignments
      >

type ConflictWhereValidation<
  TTable extends AnyTable,
  TWhere,
> = TWhere extends undefined
  ? unknown
  : [Exclude<RequiresOf<TWhere>, ConflictSources<TTable>>] extends [never]
    ? unknown
    : QueryTypeValidation<
        'missing-source',
        'upsert.update.where',
        'Use expressions scoped to the target table or excluded row.',
        Exclude<RequiresOf<TWhere>, ConflictSources<TTable>>
      >

type ConflictActionValidation<
  TTable extends AnyTable,
  TAction extends ConflictAction,
> =
  TAction extends DoUpdateAction<infer TAssignments, infer TWhere>
    ? ConflictAssignmentValidation<TTable, TAssignments> &
        ConflictWhereValidation<TTable, TWhere>
    : unknown

type ConflictActionCapabilities<TAction extends ConflictAction> =
  TAction extends DoUpdateAction<infer TAssignments, infer TWhere>
    ? CapabilityMetadataOf<
        TAssignments[keyof TAssignments] | Exclude<TWhere, undefined>
      >
    : never

export interface OnConflictClause<
  TAction extends ConflictAction = ConflictAction,
> extends Fragment<
    RequiresCapabilityMeta<'on-conflict'> | ConflictActionCapabilities<TAction>
  > {
  readonly clauseKind: 'on-conflict'
  readonly target: KeyConstraint | undefined
  readonly action: TAction
}

export type InsertClause = MutationReturningClause | OnConflictClause

export function onConflict(
  action: DoNothingAction
): OnConflictClause<DoNothingAction>
export function onConflict<
  const TTable extends AnyTable,
  const TTarget extends ConflictTarget<TTable>,
  const TAction extends ConflictAction,
>(
  table: TTable,
  target: TTarget,
  action: TAction & ConflictActionValidation<TTable, TAction>
): OnConflictClause<TAction>
export function onConflict(
  ...args:
    | readonly [DoNothingAction]
    | readonly [AnyTable, KeyConstraint, ConflictAction]
): OnConflictClause {
  const table = args.length === 1 ? undefined : args[0]
  const target = args.length === 1 ? undefined : args[1]
  const action = args.length === 1 ? args[0] : args[2]

  if (table !== undefined && target !== undefined) {
    validateConflictTarget(table, target)
  }
  validateConflictAction(table, action)

  return Object.freeze({
    clauseKind: 'on-conflict' as const,
    target,
    action,
    render(context: RenderContext) {
      assertDialectCapability(context.dialect, 'on-conflict')
      context.append('ON CONFLICT')

      if (target !== undefined) {
        context.append(' (')
        target.columns.forEach((column, index) => {
          if (index > 0) context.append(', ')
          context.render(
            identifier(table?.sqlNames[column.fieldName] ?? column.columnName)
          )
        })
        context.append(')')
      }

      if (action.actionKind === 'do-nothing') {
        context.append(' DO NOTHING')
        return
      }

      context.append(' DO UPDATE SET ')
      Object.entries(action.assignments)
        .filter(([, value]) => value !== omit)
        .forEach(([columnName, value], index) => {
          if (index > 0) context.append(', ')
          context.render(identifier(table?.sqlNames[columnName] ?? columnName))
          context.append(' = ')
          if (isExpression(value)) context.render(value)
          else context.parameter(value)
        })

      if (action.where !== undefined) {
        context.append(' ')
        context.render(action.where)
      }
    },
  }) as OnConflictClause
}

function validateConflictTarget(table: AnyTable, target: KeyConstraint) {
  if (
    (target.kind !== 'primary-key' && target.kind !== 'unique') ||
    target.columns.length === 0
  ) {
    throw queryValidationError({
      code: 'invalid-mutation',
      context: 'upsert.conflict.target',
      path: ['onConflict', 'target'],
      message: 'ON CONFLICT requires a non-empty primary or unique key target',
      hint: 'Use a declared primaryKey() or unique() constraint from the target table.',
    })
  }

  const tableColumns = new Set(Object.values(table.columns))
  if (target.columns.some(column => !tableColumns.has(column))) {
    throw queryValidationError({
      code: 'invalid-mutation',
      context: 'upsert.conflict.target',
      path: ['onConflict', 'target', 'columns'],
      message: 'ON CONFLICT target columns must belong to the target table',
      hint: 'Use the key constraint declared on the INSERT target table.',
    })
  }
}

function validateConflictAction(
  table: AnyTable | undefined,
  action: ConflictAction
) {
  if (action.actionKind === 'do-nothing') {
    if (table === undefined) return
    return
  }

  if (table === undefined) {
    throw queryValidationError({
      code: 'invalid-mutation',
      context: 'upsert.conflict.action',
      path: ['onConflict', 'action'],
      message: 'DO UPDATE requires a target table and conflict target',
      hint: 'Pass the target table and a declared key to onConflict().',
    })
  }

  const entries = Object.entries(action.assignments).filter(
    ([, value]) => value !== omit
  )
  if (entries.length === 0) {
    throw queryValidationError({
      code: 'invalid-update',
      context: 'upsert.update.assignments',
      path: ['onConflict', 'action', 'assignments'],
      message: 'DO UPDATE requires at least one assignment',
      hint: 'Provide at least one writable column, or use doNothing().',
    })
  }

  for (const [columnName] of entries) {
    const definition = table.definitions[columnName]
    if (!definition) {
      throw queryValidationError({
        code: 'invalid-update',
        context: 'upsert.update.assignments',
        path: ['onConflict', 'action', 'assignments', columnName],
        message: `Unknown update column "${columnName}"`,
        hint: 'Use only columns declared by the INSERT target table.',
      })
    }
    if (definition.generated) {
      throw queryValidationError({
        code: 'invalid-update',
        context: 'upsert.update.assignments',
        path: ['onConflict', 'action', 'assignments', columnName],
        message: `Generated column "${columnName}" cannot be updated`,
        hint: 'Remove the generated column from the DO UPDATE assignments.',
      })
    }
  }
}
