import { sql, SQL } from '../core.ts'
import {
  ColumnName,
  ColumnTable,
  ColumnType,
  IdentNamespace,
  TableColumns,
  TableName,
  TableSchema,
} from '../symbols.ts'
import { ident } from '../tokens.ts'
import { Column } from './column.ts'

export function pgTable<TColumns extends object>(
  tableName: string,
  columns: TColumns & Record<string, Column>
) {
  const table = new Proxy(new Table(tableName, columns), {
    get(table, key) {
      if (Object.prototype.hasOwnProperty.call(table[TableColumns], key)) {
        const column = table[TableColumns][key as string] as Column
        const columnRef = ident(column[ColumnName], column)
        columnRef[IdentNamespace] = tableRef(table)
        return columnRef
      }
      return table[key as keyof Table]
    },
  }) as TableWithColumns<TColumns>

  for (const [key, column] of Object.entries(columns)) {
    column[ColumnName] ||= key.replace(/([A-Z])/g, '_$1').toLowerCase()
    column[ColumnTable] = table
  }

  return table
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
    const columns = this[TableColumns] as Record<string, Column>
    return new Proxy(sql(tableRef(this)).as(alias), {
      get(table, key) {
        if (Object.prototype.hasOwnProperty.call(columns, key)) {
          const column = columns[key as string]
          const columnRef = ident(column[ColumnName], column)
          columnRef[IdentNamespace] = ident(alias)
          return sql(columnRef).mapWith(column[ColumnType])
        }
        return table[key as keyof SQL]
      },
    }) as any
  }
}

export type TableWithColumns<Columns extends object> = Table<Columns> & {
  [ColumnName in string & keyof Columns]: SQL.ColumnIdentifier<
    Extract<Columns[ColumnName], Column>
  >
}

/**
 * An identifier for an aliased table, with its columns.
 */
export type AliasedTableWithColumns<Columns extends object> = SQL & {
  [ColumnName in string & keyof Columns]: Columns[ColumnName] extends Column<
    any,
    infer TColumnOutput
  >
    ? SQL<TColumnOutput>
    : never
}
