import { identifier } from '../core/primitives/identifier.ts'
import { resolveSqlNames } from '../core/naming.ts'
import type { DependenciesOf } from '../core/fragment.ts'
import {
  createColumnReference,
  type ColumnDependency,
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
  type ColumnSqlType,
  type ColumnUpdateInput,
} from './column.ts'
import type { SourceConstraintsRecord } from './constraints.ts'

export type TableDefinitions = Record<
  string,
  ColumnDefinition<any, any, any, any, any, any, any>
>

export type AnyTable = Source<any, any, any, any, any> & {
  readonly tableName: string
  readonly definitions: TableDefinitions
  /** Application field keys mapped to physical SQL column names. */
  readonly sqlNames: Readonly<Record<string, string>>
}

export type TableRow<TDefinitions extends TableDefinitions> = {
  -readonly [K in keyof TDefinitions]: ColumnOutput<TDefinitions[K]>
}

/** SQL semantic domains derived from a table's column definitions. */
export type TableSqlTypes<TDefinitions extends TableDefinitions> = {
  readonly [K in keyof TDefinitions]: ColumnSqlType<TDefinitions[K]>
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
> = SourceColumns<
  TableRow<TDefinitions>,
  TIdentity,
  TableSqlTypes<TDefinitions>
>

export type Table<
  TName extends string = string,
  TDefinitions extends TableDefinitions = TableDefinitions,
  TConstraints extends SourceConstraintsRecord = {},
> = Source<
  TableIdentity<TName>,
  TableRow<TDefinitions>,
  never,
  TableSqlTypes<TDefinitions>,
  TConstraints
> & {
  readonly tableName: TName
  readonly definitions: TDefinitions
  /** Application field keys mapped to physical SQL column names. */
  readonly sqlNames: Readonly<Record<keyof TDefinitions & string, string>>
  readonly columns: TableColumns<TDefinitions, TableIdentity<TName>>
  readonly constraints: TConstraints
} & TableColumns<TDefinitions, TableIdentity<TName>>

/** Schema metadata that applies to a table as a relation. */
export interface TableOptions<
  TConstraints extends SourceConstraintsRecord = SourceConstraintsRecord,
> {
  readonly constraints: TConstraints
}

type ConstraintColumns<TConstraints extends SourceConstraintsRecord> =
  TConstraints[keyof TConstraints]['columns'][number]

type InvalidConstraintDependencies<
  TName extends string,
  TConstraints extends SourceConstraintsRecord,
> = Exclude<
  DependenciesOf<ConstraintColumns<TConstraints>>,
  ColumnDependency<TableIdentity<TName>, string>
>

type ConstraintValidation<
  TName extends string,
  TConstraints extends SourceConstraintsRecord,
> = [InvalidConstraintDependencies<TName, TConstraints>] extends [never]
  ? unknown
  : {
      readonly __invalid_constraint_columns__: InvalidConstraintDependencies<
        TName,
        TConstraints
      >
    }

export type TableMetadataCallback<
  TName extends string,
  TDefinitions extends TableDefinitions,
  TConstraints extends SourceConstraintsRecord,
> = (
  table: Table<TName, TDefinitions>
) => TableOptions<TConstraints> & ConstraintValidation<TName, TConstraints>

export function table<
  const TName extends string,
  const TDefinitions extends TableDefinitions,
>(name: TName, definitions: TDefinitions): Table<TName, TDefinitions>
export function table<
  const TName extends string,
  const TDefinitions extends TableDefinitions,
  const TConstraints extends SourceConstraintsRecord,
>(
  name: TName,
  definitions: TDefinitions,
  metadata: TableMetadataCallback<TName, TDefinitions, TConstraints>
): Table<TName, TDefinitions, TConstraints>
export function table<
  const TName extends string,
  const TDefinitions extends TableDefinitions,
  const TConstraints extends SourceConstraintsRecord = {},
>(
  name: TName,
  definitions: TDefinitions,
  metadata?: TableMetadataCallback<TName, TDefinitions, TConstraints>
): Table<TName, TDefinitions, TConstraints> {
  type TIdentity = TableIdentity<TName>
  type TRow = TableRow<TDefinitions>
  type TSqlTypes = TableSqlTypes<TDefinitions>

  const source = createSource<TIdentity, TRow, never, TSqlTypes>(
    'table',
    context => context.render(identifier(name)),
    identifier(name)
  )

  const sqlNames = resolveSqlNames(
    Object.entries(definitions).map(([fieldName, definition]) => ({
      fieldName,
      sqlName: definition.sqlName,
    }))
  )
  const columns = Object.fromEntries(
    Object.keys(definitions).map(fieldName => {
      const sqlName = sqlNames[fieldName]
      return [
        fieldName,
        createColumnReference(
          sqlName,
          source.reference,
          fieldName
        ) as ColumnReference<string, any>,
      ]
    })
  ) as TableColumns<TDefinitions, TIdentity>

  Object.assign(source, {
    tableName: name,
    definitions,
    sqlNames,
    columns,
    constraints: {},
  })

  // Direct column access is convenient; `.columns` remains the escape hatch
  // for a schema containing a reserved property name.
  exposeColumns(source, columns)

  const constraints = metadata
    ? metadata(source as Table<TName, TDefinitions>).constraints
    : ({} as TConstraints)
  Object.assign(source, { constraints })

  return source as Table<TName, TDefinitions, TConstraints>
}
