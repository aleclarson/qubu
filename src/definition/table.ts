import { SQL } from '../core.ts'
import { camelToSnake } from '../core/casing.ts'
import {
  ColumnName,
  ColumnTable,
  IdentNamespace,
  SQLAlias,
  TableColumns,
  TableName,
  TableSchema,
} from '../core/symbols.ts'
import { ident } from '../core/tokens.ts'
import { columnsProxy } from '../util.ts'
import { Column } from './column.ts'

export function pgTable<TColumns extends object>(
  tableName: string,
  columns: TColumns & Record<string, Column>
) {
  const table = new Table(tableName, columns)

  for (const [key, column] of Object.entries(columns)) {
    column[ColumnName] ||= camelToSnake(key)
    column[ColumnTable] = table
  }

  return columnsProxy(table, name => {
    if (Object.prototype.hasOwnProperty.call(columns, name)) {
      return new SQL.ColumnReference(columns[name])
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

  /**
   * Declare an alias for the table with the `as` operator. The
   * returned table identifier also has its columns mapped to column
   * references.
   * @returns `SQL.TableIdentifier`
   */
  as(alias: string): AliasedTableWithColumns<{
    -readonly [K in keyof TColumns]: SQL.InferColumnType<TColumns[K]>
  }> {
    const table = new SQL.TableIdentifier(alias, this)
    const columns = this[TableColumns] as Record<string, Column>

    return columnsProxy(table, name => {
      if (Object.prototype.hasOwnProperty.call(columns, name)) {
        const column = columns[name]
        return new SQL.ColumnReference(
          column,
          ident(column[ColumnName], table[SQLAlias])
        )
      }
    })
  }

  /**
   * Get a column reference by name. Safe from method name conflicts.
   * @returns `SQL.ColumnReference`
   */
  $get<K extends string & keyof TColumns>(
    name: K
  ): SQL.ColumnReference<SQL.InferColumnType<TColumns[K]>, K> {
    const column = this[TableColumns][name] as Column<any, any>
    return new SQL.ColumnReference(column)
  }

  /**
   * Select all columns from the table using wildcard syntax.
   * Optionally omit specific columns.
   * @returns `SQL.TableWildcard`
   * @example
   * ```ts
   * select(users.$getAll(), from(users))
   * // SELECT users.* FROM users
   *
   * select(users.$getAll({ omit: ['id'] }), from(users))
   * // SELECT users.name, users.email FROM users
   * ```
   */
  $getAll<TOmit extends string>(options: {
    omit?: readonly TOmit[]
  }): SQL.TableWildcard<{
    -readonly [K in keyof Omit<TColumns, TOmit>]: SQL.InferColumnType<
      TColumns[K]
    >
  }>
  $getAll(): SQL.TableWildcard<{
    -readonly [K in keyof TColumns]: SQL.InferColumnType<TColumns[K]>
  }>
  $getAll(options?: { omit?: readonly string[] }) {
    return new SQL.TableWildcard<any>(this, options?.omit)
  }
}

export type TableWithColumns<TColumns extends object> = Table<TColumns> & {
  readonly [K in keyof TColumns]: K extends string
    ? SQL.ColumnReference<SQL.InferColumnType<TColumns[K]>, K>
    : never
}

/**
 * An identifier for an aliased table, with its columns.
 */
export type AliasedTableWithColumns<Out extends object> = //
  SQL.TableIdentifier<Out> & MapColumnsToReferences<Out>

/**
 * An identifier for an aliased query, with its columns.
 */
export type AliasedQueryWithColumns<
  Out extends object,
  Name extends string,
> = SQL.QueryIdentifier<Out, Name> & MapColumnsToReferences<Out>

type MapColumnsToReferences<Out extends object> = {
  readonly [K in keyof Out]: K extends string
    ? SQL.ColumnReference<Out[K], K>
    : never
}
