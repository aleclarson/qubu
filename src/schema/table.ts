import { identifier } from '../core/primitives/identifier.ts'
import {
  createColumnReference,
  type ColumnReference,
} from '../expressions/column.ts'
import {
  createSource,
  exposeColumns,
  type Source,
  type SourceColumns,
} from './source.ts'
import {
  type ColumnDefinition,
  type ColumnHasDefault,
  type ColumnInsertInput,
  type ColumnIsGenerated,
  type ColumnOutput,
  type ColumnUpdateInput,
} from './column.ts'

export type TableDefinitions = Record<
  string,
  ColumnDefinition<any, any, any, any, any, any>
>

export type AnyTable = Source<any, any> & {
  readonly tableName: string
  readonly definitions: TableDefinitions
}

export type TableRow<TDefinitions extends TableDefinitions> = {
  -readonly [K in keyof TDefinitions]: ColumnOutput<TDefinitions[K]>
}

type RequiredInsertKeys<TDefinitions extends TableDefinitions> = {
  [K in keyof TDefinitions]-?: ColumnHasDefault<TDefinitions[K]> extends true
    ? never
    : ColumnIsGenerated<TDefinitions[K]> extends true
      ? never
      : K
}[keyof TDefinitions]

type OptionalInsertKeys<TDefinitions extends TableDefinitions> = Exclude<
  keyof TDefinitions,
  RequiredInsertKeys<TDefinitions>
>

export type TableInsertInput<TDefinitions extends TableDefinitions> = {
  -readonly [K in RequiredInsertKeys<TDefinitions>]: ColumnInsertInput<
    TDefinitions[K]
  >
} & {
  -readonly [K in OptionalInsertKeys<TDefinitions>]?: ColumnInsertInput<
    TDefinitions[K]
  >
}

export type TableUpdateInput<TDefinitions extends TableDefinitions> = {
  -readonly [K in keyof TDefinitions as ColumnIsGenerated<
    TDefinitions[K]
  > extends true
    ? never
    : K]?: ColumnUpdateInput<TDefinitions[K]>
}

export type TableIdentity<TName extends string> = {
  readonly sourceKind: 'table'
  readonly tableName: TName
}

export type TableColumns<
  TDefinitions extends TableDefinitions,
  TIdentity,
> = SourceColumns<TableRow<TDefinitions>, TIdentity>

export type Table<
  TName extends string = string,
  TDefinitions extends TableDefinitions = TableDefinitions,
> = Source<TableIdentity<TName>, TableRow<TDefinitions>> & {
  readonly tableName: TName
  readonly definitions: TDefinitions
  readonly columns: TableColumns<TDefinitions, TableIdentity<TName>>
} & TableColumns<TDefinitions, TableIdentity<TName>>

export function table<
  const TName extends string,
  const TDefinitions extends TableDefinitions,
>(name: TName, definitions: TDefinitions): Table<TName, TDefinitions> {
  type TIdentity = TableIdentity<TName>
  type TRow = TableRow<TDefinitions>

  const source = createSource<TIdentity, TRow>(
    'table',
    context => context.render(identifier(name)),
    identifier(name)
  )

  const columns = Object.fromEntries(
    Object.keys(definitions).map(columnName => [
      columnName,
      createColumnReference(columnName, source.reference) as ColumnReference<
        string,
        any
      >,
    ])
  ) as TableColumns<TDefinitions, TIdentity>

  Object.assign(source, {
    tableName: name,
    definitions,
    columns,
  })

  // Direct column access is convenient; `.columns` remains the escape hatch
  // for a schema containing a reserved property name.
  exposeColumns(source, columns)

  return source as Table<TName, TDefinitions>
}
