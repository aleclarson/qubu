import {
  comma,
  ident,
  pgArrayType,
  sequence,
  sql,
  SQL,
  unsafe,
} from '../core.ts'
import {
  ColumnConstraints,
  ColumnName,
  ColumnNullable,
  ColumnTable,
  ColumnType,
} from '../symbols.ts'
import type { Table } from './table.ts'

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
  $type() {
    return this
  }

  /**
   * Update the column's data type to an array.
   */
  array(): Column<In[], Out[], Nullable> {
    this[ColumnType] = pgArrayType(this[ColumnType]) as SQL.Type
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
    this[ColumnConstraints].push(unsafe('check'), () => sql(expression()))
    return this
  }
  references(resolve: () => OneOrMore<SQL.ColumnIdentifier>) {
    this[ColumnConstraints].push(unsafe('references'), () => {
      const columns = resolve()
      return Array.isArray(columns)
        ? sql(columns[0].context[ColumnTable], [
            sequence(
              // Ensure only the column name is used, not the table name.
              columns.map(c => ident(c.context[ColumnName])),
              comma
            ),
          ])
        : sql(columns.context[ColumnTable], [columns.context[ColumnName]])
    })
    return this
  }
  onDelete(action: OnDeleteAction) {
    this[ColumnConstraints].push(unsafe('on delete'), unsafe(action))
    return this
  }
  onUpdate(action: OnUpdateAction) {
    this[ColumnConstraints].push(unsafe('on update'), unsafe(action))
    return this
  }
}
