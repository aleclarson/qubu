import { camelToSnake } from '../casing.ts'
import { sql, SQL } from '../core.ts'
import {
  ColumnName,
  ColumnTable,
  ColumnType,
  IdentNamespace,
  SQLAlias,
  TableColumns,
  TableName,
  TableSchema,
} from '../symbols.ts'
import { ident } from '../tokens.ts'
import { columnsProxy } from '../util.ts'
import { Column } from './column.ts'

export function pgTable<TColumns extends object>(
  tableName: string,
  columns: TColumns & Record<string, Column>
) {
  const table = new Table(tableName, columns)

  for (const [key, column] of Object.entries(columns)) {
    column[ColumnName] ??= camelToSnake(key)
    column[ColumnTable] = table
  }

  return columnsProxy(table, name => {
    if (Object.prototype.hasOwnProperty.call(columns, name)) {
      const column = columns[name]
      return new SQL.ColumnReference(
        column,
        ident(column[ColumnName], getTableRef(table)),
        column[ColumnType].decode
      )
    }
  }) as TableWithColumns<TColumns>
}

/**
 * Create an identifier that references a given table.
 */
export function getTableRef(table: Table) {
  const ref = ident(table[TableName])
  if (table[TableSchema]) {
    ref[IdentNamespace] = ident(table[TableSchema])
  }
  return ref
}

export class Table<Columns extends object = {}> {
  protected [TableSchema]: string | undefined
  protected [TableName]: string
  protected [TableColumns]: Columns

  constructor(tableName: string, columns: Columns, schemaName?: string) {
    this[TableSchema] = schemaName
    this[TableName] = tableName
    this[TableColumns] = columns
  }

  as(alias: string): AliasedTableWithColumns<Columns> {
    const table = sql(getTableRef(this)).as(alias)
    const columns = this[TableColumns] as Record<string, Column>

    return columnsProxy(table, name => {
      if (Object.prototype.hasOwnProperty.call(columns, name)) {
        const column = columns[name]
        return new SQL.ColumnReference(
          column,
          ident(column[ColumnName], table[SQLAlias]),
          column[ColumnType].decode
        )
      }
    })
  }
}

export type TableWithColumns<Columns extends object> = Table<Columns> &
  MapColumnsToReferences<Columns>

/**
 * An identifier for an aliased table, with its columns.
 */
export type AliasedTableWithColumns<Columns extends object> = SQL.Expression &
  MapColumnsToReferences<Columns>

type MapColumnsToReferences<Columns extends object> = {
  [ColumnName in string & keyof Columns]: SQL.ColumnReference<
    SQL.InferOutput<Extract<Columns[ColumnName], Column>>
  >
}
