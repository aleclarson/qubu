import { StandardSchemaV1 } from '@standard-schema/spec'
import { sql, SQL } from '../core.ts'
import {
  ColumnConstraints,
  ColumnName,
  ColumnNullable,
  ColumnStandardSchema,
  ColumnTable,
  ColumnType,
  IdentColumn,
} from '../symbols.ts'
import {
  comma,
  isColumnIdentifier,
  sequence,
  Token,
  unsafe,
  withoutNamespace,
} from '../tokens.ts'
import { array } from '../type.ts'
import { tableRef, type Table } from './table.ts'

export type OnDeleteAction =
  | 'restrict'
  | 'cascade'
  | 'set null'
  | 'set default'
  | 'no action'

export type OnUpdateAction =
  | 'restrict'
  | 'cascade'
  | 'set null'
  | 'set default'
  | 'no action'

type OneOrMore<T> = T | T[]

export class Column<In = any, Out = any, Nullable extends boolean = any> {
  declare protected [ColumnTable]: Table<any>
  protected [ColumnConstraints]: (SQL.Part | (() => SQL))[] = []
  protected [ColumnName]: string
  protected [ColumnType]: SQL.Type<string, In, Out>
  protected [ColumnNullable]: Nullable
  protected [ColumnStandardSchema]: StandardSchemaV1<In, any> | null = null

  constructor(
    name: string,
    dataType: SQL.Type<string, In, Out>,
    nullable: Nullable
  ) {
    this[ColumnName] = name
    this[ColumnType] = dataType
    this[ColumnNullable] = nullable
  }

  /**
   * Narrow the column's data type. This has no effect at runtime, but
   * is especially useful for JSON types if you don't need input
   * validation at runtime.
   */
  $type<T extends Out>(): Column<Extract<T, In>, T, Nullable>
  $type<T extends In, U extends Out>(): Column<T, U, Nullable>
  /**
   * Attach a [Standard Schema][1] validator to the column, which
   * ensures the data is the expected shape at runtime. Most useful
   * for JSON columns.
   *
   * [1]: https://standardschema.dev/
   */
  $type<T extends StandardSchemaV1<In, any>>(schema: T): this
  $type(schema?: StandardSchemaV1<any>) {
    if (schema) {
      this[ColumnStandardSchema] = schema
    }
    return this
  }

  /**
   * Update the column's data type to an array.
   */
  array(): Column<In[], Out[], Nullable> {
    this[ColumnType] = array(this[ColumnType]) as SQL.Type
    return this as Column<any, any, Nullable>
  }

  /**
   * Update the column's nullable state to false.
   */
  notNull() {
    this[ColumnNullable] = false as Nullable
    return this as Column<In, Out, false>
  }

  primaryKey() {
    this[ColumnConstraints].push(unsafe('primary key'))
    return this as Column<In, Out, false>
  }
  unique() {
    this[ColumnConstraints].push(unsafe('unique'))
    return this
  }
  check(expression: () => SQL.Part[]) {
    // Note: We don't use `sql.fromArray` here because the expression
    // should be wrapped in parentheses.
    this[ColumnConstraints].push(unsafe('check'), () => sql(expression()))
    return this
  }
  references(resolve: () => Table | OneOrMore<Token.ColumnIdentifier>) {
    this[ColumnConstraints].push(unsafe('references'), () => {
      const columns = resolve()
      return Array.isArray(columns)
        ? sql(columns[0][IdentColumn][ColumnTable], [
            sequence(
              // Ensure only the column name is used, not the table name.
              columns.map(withoutNamespace),
              comma
            ),
          ])
        : isColumnIdentifier(columns)
          ? sql(columns[IdentColumn][ColumnTable], [withoutNamespace(columns)])
          : sql(tableRef(columns))
    })
    return this
  }
  onDelete(action: OnDeleteAction) {
    this[ColumnConstraints].push(unsafe(`on delete ${action}`))
    return this
  }
  onUpdate(action: OnUpdateAction) {
    this[ColumnConstraints].push(unsafe(`on update ${action}`))
    return this
  }
}
