import { identifier } from '../core/primitives/identifier.ts'
import { resolveSqlNames } from '../core/naming.ts'
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
  type ColumnIsNullable,
  type ColumnOutput,
  type ColumnSqlType,
  type ColumnUpdateInput,
} from './column.ts'
import type { SourceConstraint } from './constraints.ts'

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
  TConstraints extends readonly SourceConstraint[] = readonly [],
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
  TConstraints extends
    readonly SourceConstraint[] = readonly SourceConstraint[],
> {
  readonly constraints: TConstraints
}

type ConstraintColumns<TConstraint> = TConstraint extends SourceConstraint
  ? TConstraint['columns'][number]
  : never

type NullableConstraintColumns<
  TDefinitions extends TableDefinitions,
  TConstraint,
> =
  Extract<ConstraintColumns<TConstraint>, keyof TDefinitions> extends infer TKey
    ? TKey extends keyof TDefinitions
      ? ColumnIsNullable<TDefinitions[TKey]> extends false
        ? never
        : TKey
      : never
    : never

type InvalidConstraintColumns<
  TDefinitions extends TableDefinitions,
  TConstraints extends readonly SourceConstraint[],
> =
  | Exclude<ConstraintColumns<TConstraints[number]>, keyof TDefinitions>
  | NullableConstraintColumns<TDefinitions, TConstraints[number]>

type ConstraintValidation<
  TDefinitions extends TableDefinitions,
  TConstraints extends readonly SourceConstraint[],
> = [InvalidConstraintColumns<TDefinitions, TConstraints>] extends [never]
  ? unknown
  : {
      readonly __invalid_constraint_columns__: InvalidConstraintColumns<
        TDefinitions,
        TConstraints
      >
    }

export function table<
  const TName extends string,
  const TDefinitions extends TableDefinitions,
>(name: TName, definitions: TDefinitions): Table<TName, TDefinitions>
export function table<
  const TName extends string,
  const TDefinitions extends TableDefinitions,
  const TConstraints extends readonly SourceConstraint[],
>(
  name: TName,
  definitions: TDefinitions,
  options: TableOptions<TConstraints> &
    ConstraintValidation<TDefinitions, TConstraints>
): Table<TName, TDefinitions, TConstraints>
export function table<
  const TName extends string,
  const TDefinitions extends TableDefinitions,
  const TConstraints extends readonly SourceConstraint[] = readonly [],
>(
  name: TName,
  definitions: TDefinitions,
  options?: TableOptions<TConstraints> &
    ConstraintValidation<TDefinitions, TConstraints>
): Table<TName, TDefinitions, TConstraints> {
  type TIdentity = TableIdentity<TName>
  type TRow = TableRow<TDefinitions>
  type TSqlTypes = TableSqlTypes<TDefinitions>

  const source = createSource<TIdentity, TRow, never, TSqlTypes, TConstraints>(
    'table',
    context => context.render(identifier(name)),
    identifier(name),
    (options?.constraints ?? []) as TConstraints
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
    constraints: options?.constraints ?? [],
  })

  // Direct column access is convenient; `.columns` remains the escape hatch
  // for a schema containing a reserved property name.
  exposeColumns(source, columns)

  return source as Table<TName, TDefinitions, TConstraints>
}
