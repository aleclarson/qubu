import { camelToSnake } from '../casing.ts'
import { sql, SQL } from '../core.ts'
import {
  ColumnName,
  ColumnTable,
  ColumnType,
  IdentNamespace,
  PgTable,
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
export function getTableRef(table: Table<any>) {
  const ref = ident(table[TableName])
  if (table[TableSchema]) {
    ref[IdentNamespace] = ident(table[TableSchema])
  }
  return ref
}

export class Table<TColumns extends object = {}> {
  protected [TableSchema]: string | undefined
  protected [TableName]: string
  protected [TableColumns]: TColumns

  constructor(tableName: string, columns: TColumns, schemaName?: string) {
    this[TableSchema] = schemaName
    this[TableName] = tableName
    this[TableColumns] = columns
  }

  as(
    alias: string
  ): SQL.InferOutput<Table<TColumns>> extends infer TOutput extends object[]
    ? AliasedTableWithColumns<TOutput[number]>
    : never {
    const columns = this[TableColumns] as Record<string, Column>
    const table = sql(getTableRef(this)).as(alias) as SQL.TableIdentifier<any>
    table[PgTable] = this

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

export type TableWithColumns<TColumns extends object> = Table<TColumns> & {
  [K in keyof TColumns]: K extends string
    ? SQL.ColumnReference<SQL.InferColumnType<TColumns[K]>, K>
    : never
}

/**
 * An identifier for an aliased table, with its columns.
 */
export type AliasedTableWithColumns<Out extends object> = //
  SQL.TableIdentifier<Out[]> & MapColumnsToReferences<Out>

/**
 * An identifier for an aliased query, with its columns.
 */
export type AliasedQueryWithColumns<Out extends object> = //
  SQL.QueryIdentifier<Out[]> & MapColumnsToReferences<Out>

type MapColumnsToReferences<Out extends object> = {
  [K in keyof Out]: K extends string ? SQL.ColumnReference<Out[K], K> : never
}
