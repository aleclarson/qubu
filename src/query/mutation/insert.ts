import { identifier } from '../../core/primitives/identifier.ts'
import { isExpression } from '../../expressions/types.ts'
import type { RenderContext } from '../../core/fragment.ts'
import type { CapabilityMetadataOf } from '../../core/fragment.ts'
import type { Query } from '../types.ts'
import type {
  ColumnHasDefault,
  ColumnIsGenerated,
} from '../../schema/column.ts'
import type { AnyTable, TableInsertInput } from '../../schema/table.ts'
import {
  createMutation,
  type MutationQuery,
  type MutationCapabilityMetadata,
  type MutationReturningClause,
  type MutationRow,
  type MutationScopeValidation,
  type MutationSqlTypes,
} from './types.ts'
import { queryValidationError, type QueryTypeValidation } from '../errors.ts'

export interface ValuesSource<
  TRows extends readonly object[] = readonly object[],
> {
  readonly insertKind: 'values'
  readonly rows: TRows
}

export function values<const TRows extends readonly [object, ...object[]]>(
  ...rows: TRows
): ValuesSource<TRows> {
  return Object.freeze({ insertKind: 'values' as const, rows })
}

export interface DefaultValuesSource {
  readonly insertKind: 'default-values'
}

export function defaultValues(): DefaultValuesSource {
  return Object.freeze({ insertKind: 'default-values' as const })
}

export interface InsertSelectSource<
  TQuery extends Query<any, any, any> = Query<any, any, any>,
  TColumns extends readonly string[] = readonly string[],
> {
  readonly insertKind: 'select'
  readonly query: TQuery
  readonly columns: TColumns
}

export function insertSelect<
  TQuery extends Query<any, any, any>,
  const TColumns extends readonly [string, ...string[]],
>(query: TQuery, columns: TColumns): InsertSelectSource<TQuery, TColumns> {
  return Object.freeze({
    insertKind: 'select' as const,
    query,
    columns,
  })
}

export type InsertSource =
  | ValuesSource<any>
  | DefaultValuesSource
  | InsertSelectSource<any, any>

type InsertSourceCapabilityMetadata<TSource extends InsertSource> =
  TSource extends InsertSelectSource<infer TQuery, any>
    ? CapabilityMetadataOf<TQuery>
    : never

type InsertRow<TTable extends AnyTable> = TableInsertInput<
  TTable['definitions']
>

type InvalidInsertRow<TTable extends AnyTable, TRow> =
  TRow extends InsertRow<TTable>
    ? Exclude<keyof TRow, keyof InsertRow<TTable>> extends never
      ? unknown
      : QueryTypeValidation<
          'invalid-insert',
          'insert.values.columns',
          'Use only columns declared by the insert table.',
          Exclude<keyof TRow, keyof InsertRow<TTable>>
        >
    : QueryTypeValidation<
        'invalid-insert',
        'insert.values.row',
        'Provide values matching the insert table columns.',
        TRow
      >

type ValidInsertSource<TTable extends AnyTable, TSource extends InsertSource> =
  TSource extends ValuesSource<infer TRows>
    ? TRows[number] extends infer TRow
      ? InvalidInsertRow<TTable, TRow>
      : never
    : TSource extends DefaultValuesSource
      ? Exclude<
          keyof TTable['definitions'],
          {
            [K in keyof TTable['definitions']]-?: ColumnIsGenerated<
              TTable['definitions'][K]
            > extends true
              ? K
              : TTable['definitions'][K] extends { hasDefault: true }
                ? K
                : never
          }[keyof TTable['definitions']]
        > extends never
        ? unknown
        : QueryTypeValidation<
            'invalid-insert',
            'insert.default-values',
            'Provide values for required columns or define defaults for them.',
            Exclude<
              keyof TTable['definitions'],
              {
                [K in keyof TTable['definitions']]-?: ColumnIsGenerated<
                  TTable['definitions'][K]
                > extends true
                  ? K
                  : TTable['definitions'][K] extends { hasDefault: true }
                    ? K
                    : never
              }[keyof TTable['definitions']]
            >
          >
      : TSource extends InsertSelectSource<any, infer TColumns>
        ? Exclude<TColumns[number], keyof TTable['definitions']> extends never
          ? Exclude<
              {
                [K in keyof TTable['definitions']]-?: ColumnIsGenerated<
                  TTable['definitions'][K]
                > extends true
                  ? never
                  : ColumnHasDefault<TTable['definitions'][K]> extends true
                    ? never
                    : K
              }[keyof TTable['definitions']],
              TColumns[number]
            > extends never
            ? unknown
            : QueryTypeValidation<
                'invalid-insert',
                'insert.select.columns',
                'Include every required insert column in the target list.',
                Exclude<
                  {
                    [K in keyof TTable['definitions']]-?: ColumnIsGenerated<
                      TTable['definitions'][K]
                    > extends true
                      ? never
                      : ColumnHasDefault<TTable['definitions'][K]> extends true
                        ? never
                        : K
                  }[keyof TTable['definitions']],
                  TColumns[number]
                >
              >
          : QueryTypeValidation<
              'invalid-insert',
              'insert.select.columns',
              'Use only columns declared by the insert table.',
              Exclude<TColumns[number], keyof TTable['definitions']>
            >
        : never

export function insertInto<
  const TTable extends AnyTable,
  const TSource extends InsertSource,
  const TClauses extends readonly MutationReturningClause[],
>(
  table: TTable,
  source: TSource & ValidInsertSource<TTable, TSource>,
  ...clauses: TClauses & MutationScopeValidation<TTable, TClauses>
): MutationQuery<
  MutationRow<TClauses>,
  'insert',
  | MutationCapabilityMetadata<TClauses[number]>
  | InsertSourceCapabilityMetadata<TSource>,
  MutationSqlTypes<TClauses>
> {
  validateInsert(table, source)

  const returningClauses = clauses as readonly MutationReturningClause[]
  const row =
    returningClauses.find(clause => clause.clauseKind === 'returning')?.row ??
    {}
  const query = createMutation('insert', row, context => {
    context.append('INSERT INTO ')
    context.render(table.reference)

    if (source.insertKind === 'values') {
      const rows = source.rows as readonly Record<string, unknown>[]
      const columns = Object.keys(rows[0] ?? {})
      if (columns.length === 0) {
        context.append(' DEFAULT VALUES')
      } else {
        renderTargetColumns(context, table, columns)
        context.append(' VALUES ')
        rows.forEach((row, rowIndex) => {
          if (rowIndex > 0) context.append(', ')
          context.append('(')
          columns.forEach((columnName, columnIndex) => {
            if (columnIndex > 0) context.append(', ')
            renderInsertValue(context, row[columnName])
          })
          context.append(')')
        })
      }
    } else if (source.insertKind === 'default-values') {
      context.append(' DEFAULT VALUES')
    } else {
      renderTargetColumns(context, table, source.columns)
      context.append(' ')
      context.renderRelation(source.query)
    }

    for (const clause of returningClauses) {
      context.append(' ')
      context.render(clause)
    }
  })

  return query as unknown as MutationQuery<
    MutationRow<TClauses>,
    'insert',
    | MutationCapabilityMetadata<TClauses[number]>
    | InsertSourceCapabilityMetadata<TSource>,
    MutationSqlTypes<TClauses>
  >
}

function renderTargetColumns(
  context: RenderContext,
  table: AnyTable,
  columns: readonly string[]
) {
  context.append(' (')
  columns.forEach((columnName, index) => {
    if (index > 0) context.append(', ')
    context.render(identifier(table.sqlNames[columnName] ?? columnName))
  })
  context.append(')')
}

function renderInsertValue(context: RenderContext, input: unknown) {
  if (isExpression(input)) context.render(input)
  else context.parameter(input)
}

function validateInsert(table: AnyTable, source: InsertSource) {
  const definitions = table.definitions as Record<
    string,
    { generated?: boolean; hasDefault?: boolean }
  >
  if (source.insertKind === 'values') {
    const firstColumns = Object.keys(source.rows[0] ?? {})
    const firstSet = new Set(firstColumns)
    for (const columnName of firstColumns) {
      if (!definitions[columnName]) {
        throw queryValidationError({
          code: 'invalid-insert',
          context: 'insert.values.columns',
          path: ['values', columnName],
          message: `Unknown insert column "${columnName}"`,
          hint: 'Use only columns declared by the insert table.',
        })
      }
      if (definitions[columnName].generated) {
        throw queryValidationError({
          code: 'invalid-insert',
          context: 'insert.values.columns',
          path: ['values', columnName],
          message: `Generated column "${columnName}" cannot be inserted`,
          hint: 'Omit generated columns from the insert values.',
        })
      }
    }
    for (const row of source.rows) {
      const columns = Object.keys(row)
      if (
        columns.length !== firstColumns.length ||
        columns.some(columnName => !firstSet.has(columnName))
      ) {
        throw queryValidationError({
          code: 'invalid-insert',
          context: 'insert.values.rows',
          path: ['values', 'rows'],
          message: 'All INSERT values rows must use the same columns',
          hint: 'Use one identical column set for every values row.',
        })
      }
    }
    for (const [columnName, definition] of Object.entries(definitions)) {
      if (definition.generated || definition.hasDefault) continue
      if (!firstSet.has(columnName)) {
        throw queryValidationError({
          code: 'invalid-insert',
          context: 'insert.values.columns',
          path: ['values', columnName],
          message: `Required insert column "${columnName}" is missing`,
          hint: 'Provide the column value or define a default for it.',
        })
      }
    }
  } else if (source.insertKind === 'default-values') {
    for (const [columnName, definition] of Object.entries(definitions)) {
      if (!definition.generated && !definition.hasDefault) {
        throw queryValidationError({
          code: 'invalid-insert',
          context: 'insert.default-values',
          path: ['defaultValues', columnName],
          message: `DEFAULT VALUES requires column "${columnName}" to have a default`,
          hint: 'Provide values for required columns or define defaults for them.',
        })
      }
    }
  } else {
    if (source.columns.length === 0) {
      throw queryValidationError({
        code: 'invalid-insert',
        context: 'insert.select.columns',
        path: ['insertSelect', 'columns'],
        message: 'INSERT ... SELECT requires at least one target column',
        hint: 'List the target columns receiving the SELECT result.',
      })
    }
    const seen = new Set<string>()
    for (const columnName of source.columns) {
      if (seen.has(columnName))
        throw queryValidationError({
          code: 'duplicate-clause',
          context: 'insert.select.columns',
          path: ['insertSelect', 'columns', columnName],
          message: `Duplicate insert column "${columnName}"`,
          hint: 'List each insert target column once.',
        })
      seen.add(columnName)
      if (!definitions[columnName]) {
        throw queryValidationError({
          code: 'invalid-insert',
          context: 'insert.select.columns',
          path: ['insertSelect', 'columns', columnName],
          message: `Unknown insert column "${columnName}"`,
          hint: 'Use only columns declared by the insert table.',
        })
      }
      if (definitions[columnName].generated) {
        throw queryValidationError({
          code: 'invalid-insert',
          context: 'insert.select.columns',
          path: ['insertSelect', 'columns', columnName],
          message: `Generated column "${columnName}" cannot be inserted`,
          hint: 'Omit generated columns from the insert target list.',
        })
      }
    }
    for (const [columnName, definition] of Object.entries(definitions)) {
      if (definition.generated || definition.hasDefault) continue
      if (!seen.has(columnName)) {
        throw queryValidationError({
          code: 'invalid-insert',
          context: 'insert.select.columns',
          path: ['insertSelect', 'columns', columnName],
          message: `Required insert column "${columnName}" is missing`,
          hint: 'Include every required insert column in the target list.',
        })
      }
    }
  }
}
