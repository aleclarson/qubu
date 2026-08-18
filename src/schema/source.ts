import {
  type Fragment,
  type RequiresSourceMeta,
  type RenderFunction,
  type ResultMeta,
} from '../core/fragment.ts'
import type { ColumnReference } from '../expressions/column.ts'

export const sourceIdentity: unique symbol = Symbol('qubu.source.identity')

export type SourceKind = 'table' | 'table-alias' | 'query-alias' | 'cte'

export type SourceColumns<TRow extends object, TIdentity> = {
  readonly [K in keyof TRow]-?: K extends string
    ? ColumnReference<
        K,
        ResultMeta<TRow[K], TIdentity> | RequiresSourceMeta<TIdentity>
      >
    : never
}

export interface Source<
  TIdentity = unknown,
  TRow extends object = Record<string, unknown>,
> extends Fragment<ResultMeta<readonly TRow[]>> {
  readonly sourceKind: SourceKind
  readonly [sourceIdentity]: TIdentity
  readonly reference: Fragment<never>
  readonly columns: SourceColumns<TRow, TIdentity>
}

export type AnySource = Source<any, any>
export type SourceIdentity<T> =
  T extends Source<infer TIdentity, any> ? TIdentity : never
export type SourceRow<T> = T extends Source<any, infer TRow> ? TRow : never

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
