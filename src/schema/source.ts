import {
  type ExpressionMeta,
  type Fragment,
  type MetadataOf,
  type ProvidesSourceMeta,
  type RequiresSourceMeta,
  type RenderFunction,
  type ResultMeta,
} from '../core/fragment.ts'
import type { AnySqlType, SqlUnknown } from '../core/sql-types.ts'
import type { TableDefinitions, TableRow } from './table.ts'
import type {
  ColumnDependency,
  ColumnReference,
} from '../expressions/column.ts'
import { createColumnReference } from '../expressions/column.ts'
import { resolveSqlNames } from '../core/naming.ts'
import type { SourceConstraintsRecord } from './constraints.ts'
import { columnResultValue } from './column.ts'

export const sourceIdentity: unique symbol = Symbol('qubu.source.identity')

export type SourceKind =
  | 'table'
  | 'table-alias'
  | 'query-alias'
  | 'lateral'
  | 'cte'
  | 'excluded'
  | 'custom'
  | 'table-function'

/** SQL semantic domains keyed by the application fields of a source row. */
export type SourceSqlTypes<TRow extends object> = {
  readonly [K in keyof TRow]: AnySqlType
}

/** A source SQL-domain map used when no stronger metadata was declared. */
export type UnknownSourceSqlTypes<TRow extends object> = {
  readonly [K in keyof TRow]: SqlUnknown
}

export type SourceColumns<
  TRow extends object,
  TIdentity,
  TSqlTypes extends SourceSqlTypes<TRow> = UnknownSourceSqlTypes<TRow>,
> = {
  readonly [K in keyof TRow]: K extends string
    ? ColumnReference<
        K,
        | ResultMeta<Required<TRow>[K], TIdentity, TSqlTypes[K]>
        | RequiresSourceMeta<TIdentity>
        | ExpressionMeta<ColumnDependency<TIdentity, K>>
      >
    : never
}

export interface Source<
  TIdentity = unknown,
  TRow extends object = Record<string, unknown>,
  TMetadata = never,
  TSqlTypes extends SourceSqlTypes<TRow> = UnknownSourceSqlTypes<TRow>,
  TConstraints extends SourceConstraintsRecord = {},
> extends Fragment<
    | ResultMeta<readonly TRow[]>
    | ProvidesSourceMeta<TIdentity, TRow>
    | TMetadata
  > {
  readonly sourceKind: SourceKind
  readonly [sourceIdentity]: TIdentity
  readonly reference: Fragment<never>
  readonly columns: SourceColumns<TRow, TIdentity, TSqlTypes>
  readonly constraints: TConstraints
}

export type AnySource = Source<any, any, any, any, any>

/** The source-provision fact carried by a source-producing fragment. */
export type SourceProvision<T> = Extract<
  MetadataOf<T>,
  { readonly kind: 'provides-source' }
>

export type ProvidedSourceIdentity<T> =
  SourceProvision<T> extends ProvidesSourceMeta<infer TIdentity, any>
    ? TIdentity
    : never

export type ProvidedSourceRow<T> =
  SourceProvision<T> extends ProvidesSourceMeta<any, infer TRow> ? TRow : never

export type SourceIdentity<T> =
  T extends Source<infer TIdentity, any, any, any, any> ? TIdentity : never
export type SourceRow<T> =
  T extends Source<any, infer TRow, any, any, any> ? TRow : never
/** Extract the field-to-SQL-domain map retained by a source. */
export type SourceSqlTypeMap<T> = T extends {
  readonly definitions: infer TDefinitions extends TableDefinitions
}
  ? import('./table.ts').TableSqlTypes<TDefinitions>
  : T extends Source<any, infer TRow, any, infer TSqlTypes, any>
    ? TSqlTypes & SourceSqlTypes<TRow>
    : never
/** Structured schema constraints declared for a source. */
export type SourceConstraints<T> = T extends {
  readonly constraints: infer TConstraints extends SourceConstraintsRecord
}
  ? TConstraints
  : never

export interface CustomSourceOptions<
  TIdentity,
  TDefinitions extends TableDefinitions,
> {
  /** The type-level identity used by columns and source-scope validation. */
  readonly identity: TIdentity
  /** The SQL fragment that renders the relation in FROM or JOIN. */
  readonly render: RenderFunction
  /** The qualified reference used when rendering its columns. */
  readonly reference: Fragment<never>
  /** Output definitions used to build the source's typed columns. */
  readonly columns: TDefinitions
  readonly sourceKind?: SourceKind
}

export type CustomSource<
  TIdentity,
  TDefinitions extends TableDefinitions,
> = Source<
  TIdentity,
  TableRow<TDefinitions>,
  never,
  import('./table.ts').TableSqlTypes<TDefinitions>
> & {
  readonly identity: TIdentity
  readonly definitions: TDefinitions
  readonly columns: SourceColumns<
    TableRow<TDefinitions>,
    TIdentity,
    import('./table.ts').TableSqlTypes<TDefinitions>
  >
} & SourceColumns<
    TableRow<TDefinitions>,
    TIdentity,
    import('./table.ts').TableSqlTypes<TDefinitions>
  >

export function createSource<
  TIdentity,
  TRow extends object,
  TMetadata = never,
  TSqlTypes extends SourceSqlTypes<TRow> = UnknownSourceSqlTypes<TRow>,
  TConstraints extends SourceConstraintsRecord = {},
>(
  sourceKind: SourceKind,
  render: RenderFunction,
  reference: Fragment<never>,
  constraints: TConstraints = {} as TConstraints
): Source<TIdentity, TRow, TMetadata, TSqlTypes, TConstraints> {
  return {
    sourceKind,
    render,
    reference,
    columns: {} as SourceColumns<TRow, TIdentity, TSqlTypes>,
    constraints,
  } as Source<TIdentity, TRow, TMetadata, TSqlTypes, TConstraints>
}

/**
 * Create a typed source-producing fragment for a custom FROM relation such as
 * a table-valued function. The renderer owns the relation syntax and may bind
 * values through context.parameter(); the source identity and output columns
 * remain available to the normal FROM/JOIN scope checks.
 */
export function customSource<
  const TIdentity,
  const TDefinitions extends TableDefinitions,
>(
  options: CustomSourceOptions<TIdentity, TDefinitions>
): CustomSource<TIdentity, TDefinitions> {
  type TRow = TableRow<TDefinitions>
  type TSqlTypes = import('./table.ts').TableSqlTypes<TDefinitions>
  const source = createSource<TIdentity, TRow, never, TSqlTypes>(
    options.sourceKind ?? 'custom',
    options.render,
    options.reference
  )
  const sqlNames = resolveSqlNames(
    Object.entries(options.columns).map(([fieldName, definition]) => ({
      fieldName,
      sqlName: definition.sqlName,
    }))
  )
  const columns = Object.fromEntries(
    Object.keys(options.columns).map(fieldName => {
      return [
        fieldName,
        createColumnReference(
          sqlNames[fieldName],
          source.reference,
          fieldName,
          columnResultValue(options.columns[fieldName])
        ) as ColumnReference<string, any>,
      ]
    })
  ) as SourceColumns<TRow, TIdentity, TSqlTypes>

  Object.assign(source, {
    identity: options.identity,
    definitions: options.columns,
    columns,
  })
  exposeColumns(source, columns)

  return source as CustomSource<TIdentity, TDefinitions>
}

/**
 * Add convenient direct column properties without allowing a column name to
 * overwrite the source's rendering or metadata primitives.
 */
export function exposeColumns(
  target: object,
  columns: Record<string, unknown>
) {
  const reserved = new Set([
    'render',
    'reference',
    'sourceKind',
    'columns',
    'tableName',
    'definitions',
    'sqlNames',
    'alias',
    'base',
    'query',
    'cteName',
    'identity',
    'constraints',
  ])

  for (const [name, column] of Object.entries(columns)) {
    if (reserved.has(name)) continue
    Object.defineProperty(target, name, {
      configurable: true,
      enumerable: true,
      value: column,
      writable: false,
    })
  }
}
