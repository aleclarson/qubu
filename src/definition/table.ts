import { camelToSnake } from '../casing.ts'
import { sql, SQL } from '../core.ts'
import {
  ColumnName,
  ColumnTable,
  IdentNamespace,
  TableColumns,
  TableName,
  TableSchema,
} from '../symbols.ts'
import { ident, Token } from '../tokens.ts'
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

  return columnsProxy(table, key => {
    if (Object.prototype.hasOwnProperty.call(columns, key)) {
      const column = columns[key as string] as Column
      const columnRef = ident(column[ColumnName], column)
      columnRef[IdentNamespace] = tableRef(table)
      return columnRef satisfies Token.ColumnIdentifier
    }
  }) as TableWithColumns<TColumns>
}

/**
 * Create an identifier that references a given table.
 */
export function tableRef(table: Table) {
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
    const table = sql(tableRef(this)).as(alias)
    const columns = this[TableColumns] as Record<string, Column>

    return columnsProxy(table, key => {
      if (Object.prototype.hasOwnProperty.call(columns, key)) {
        const column = columns[key as string]
        const columnRef = ident(column[ColumnName], column)
        columnRef[IdentNamespace] = ident(alias)
        return columnRef satisfies Token.ColumnIdentifier
      }
    })
  }
}

export type TableWithColumns<Columns extends object> = Table<Columns> &
  MapColumnsToIdentifiers<Columns>

/**
 * An identifier for an aliased table, with its columns.
 */
export type AliasedTableWithColumns<Columns extends object> = SQL.Expression &
  MapColumnsToIdentifiers<Columns>

type MapColumnsToIdentifiers<Columns extends object> = {
  [ColumnName in string & keyof Columns]: Token.ColumnIdentifier<
    Extract<Columns[ColumnName], Column>
  >
}
