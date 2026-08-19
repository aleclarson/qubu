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

export const fromSelect = insertSelect
export const insertFrom = insertSelect

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
      : {
          readonly __unknown_insert_columns__: Exclude<
            keyof TRow,
            keyof InsertRow<TTable>
          >
        }
    : { readonly __invalid_insert_row__: TRow }

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
        : { readonly __default_values_require_defaults__: never }
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
            : { readonly __required_insert_select_columns__: never }
          : {
              readonly __unknown_insert_select_columns__: Exclude<
                TColumns[number],
                keyof TTable['definitions']
              >
            }
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
        throw new Error(`Unknown insert column "${columnName}"`)
      }
      if (definitions[columnName].generated) {
        throw new Error(`Generated column "${columnName}" cannot be inserted`)
      }
    }
    for (const row of source.rows) {
      const columns = Object.keys(row)
      if (
        columns.length !== firstColumns.length ||
        columns.some(columnName => !firstSet.has(columnName))
      ) {
        throw new Error('All INSERT values rows must use the same columns')
      }
    }
    for (const [columnName, definition] of Object.entries(definitions)) {
      if (definition.generated || definition.hasDefault) continue
      if (!firstSet.has(columnName)) {
        throw new Error(`Required insert column "${columnName}" is missing`)
      }
    }
  } else if (source.insertKind === 'default-values') {
    for (const [columnName, definition] of Object.entries(definitions)) {
      if (!definition.generated && !definition.hasDefault) {
        throw new Error(
          `DEFAULT VALUES requires column "${columnName}" to have a default`
        )
      }
    }
  } else {
    if (source.columns.length === 0) {
      throw new Error('INSERT ... SELECT requires at least one target column')
    }
    const seen = new Set<string>()
    for (const columnName of source.columns) {
      if (seen.has(columnName))
        throw new Error(`Duplicate insert column "${columnName}"`)
      seen.add(columnName)
      if (!definitions[columnName]) {
        throw new Error(`Unknown insert column "${columnName}"`)
      }
      if (definitions[columnName].generated) {
        throw new Error(`Generated column "${columnName}" cannot be inserted`)
      }
    }
    for (const [columnName, definition] of Object.entries(definitions)) {
      if (definition.generated || definition.hasDefault) continue
      if (!seen.has(columnName)) {
        throw new Error(`Required insert column "${columnName}" is missing`)
      }
    }
  }
}
