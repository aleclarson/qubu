import {
  type ExpressionMeta,
  type Fragment,
  type MetadataOf,
  type ProvidesSourceMeta,
  type RequiresSourceMeta,
  type RenderFunction,
  type ResultMeta,
} from '../core/fragment.ts'
import type { TableDefinitions, TableRow } from './table.ts'
import type {
  ColumnDependency,
  ColumnReference,
} from '../expressions/column.ts'
import { createColumnReference } from '../expressions/column.ts'

export const sourceIdentity: unique symbol = Symbol('qubu.source.identity')

export type SourceKind =
  | 'table'
  | 'table-alias'
  | 'query-alias'
  | 'cte'
  | 'custom'
  | 'table-function'

export type SourceColumns<TRow extends object, TIdentity> = {
  readonly [K in keyof TRow]-?: K extends string
    ? ColumnReference<
        K,
        | ResultMeta<TRow[K], TIdentity>
        | RequiresSourceMeta<TIdentity>
        | ExpressionMeta<ColumnDependency<TIdentity, K>>
      >
    : never
}

export interface Source<
  TIdentity = unknown,
  TRow extends object = Record<string, unknown>,
> extends Fragment<
    ResultMeta<readonly TRow[]> | ProvidesSourceMeta<TIdentity, TRow>
  > {
  readonly sourceKind: SourceKind
  readonly [sourceIdentity]: TIdentity
  readonly reference: Fragment<never>
  readonly columns: SourceColumns<TRow, TIdentity>
}

export type AnySource = Source<any, any>

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
  T extends Source<infer TIdentity, any> ? TIdentity : never
export type SourceRow<T> = T extends Source<any, infer TRow> ? TRow : never

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
> = Source<TIdentity, TableRow<TDefinitions>> & {
  readonly identity: TIdentity
  readonly definitions: TDefinitions
  readonly columns: SourceColumns<TableRow<TDefinitions>, TIdentity>
} & SourceColumns<TableRow<TDefinitions>, TIdentity>

export function createSource<TIdentity, TRow extends object>(
  sourceKind: SourceKind,
  render: RenderFunction,
  reference: Fragment<never>
): Source<TIdentity, TRow> {
  return {
    sourceKind,
    render,
    reference,
    columns: {} as SourceColumns<TRow, TIdentity>,
  } as Source<TIdentity, TRow>
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
  const source = createSource<TIdentity, TRow>(
    options.sourceKind ?? 'custom',
    options.render,
    options.reference
  )
  const columns = Object.fromEntries(
    Object.keys(options.columns).map(columnName => [
      columnName,
      createColumnReference(columnName, source.reference) as ColumnReference<
        string,
        any
      >,
    ])
  ) as SourceColumns<TRow, TIdentity>

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
    'alias',
    'base',
    'query',
    'cteName',
    'identity',
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
