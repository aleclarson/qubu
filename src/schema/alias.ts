import { identifier } from '../core/primitives/identifier.ts'
import { parenthesize } from '../core/fragment.ts'
import {
  createColumnReference,
  type ColumnReference,
} from '../expressions/column.ts'
import type { AnyQuery, Query } from '../query/types.ts'
import {
  createSource,
  exposeColumns,
  type Source,
  type SourceColumns,
  type SourceIdentity,
  type SourceRow,
} from './source.ts'

export type AliasIdentity<TBase, TAlias extends string> = {
  readonly sourceKind: 'alias'
  readonly alias: TAlias
  readonly base: TBase
}

export type AliasedSource<
  TBase extends Source<any, any>,
  TAlias extends string,
> = Source<AliasIdentity<SourceIdentity<TBase>, TAlias>, SourceRow<TBase>> & {
  readonly alias: TAlias
  readonly base: TBase
  readonly columns: SourceColumns<
    SourceRow<TBase>,
    AliasIdentity<SourceIdentity<TBase>, TAlias>
  >
} & SourceColumns<
    SourceRow<TBase>,
    AliasIdentity<SourceIdentity<TBase>, TAlias>
  >

export type QueryAliasIdentity<TAlias extends string> = {
  readonly sourceKind: 'query-alias'
  readonly alias: TAlias
}

export type QuerySource<TRow extends object, TAlias extends string> = Source<
  QueryAliasIdentity<TAlias>,
  TRow
> & {
  readonly alias: TAlias
  readonly query: Query<TRow, any>
  readonly columns: SourceColumns<TRow, QueryAliasIdentity<TAlias>>
} & SourceColumns<TRow, QueryAliasIdentity<TAlias>>

export function alias<
  TBase extends Source<any, any>,
  const TAlias extends string,
>(source: TBase, name: TAlias): AliasedSource<TBase, TAlias>
export function alias<TRow extends object, const TAlias extends string>(
  query: Query<TRow, any>,
  name: TAlias
): QuerySource<TRow, TAlias>
export function alias(
  sourceOrQuery: Source<any, any> | AnyQuery,
  name: string
) {
  const reference = identifier(name)
  const isQuery = 'queryKind' in sourceOrQuery
  const source = createSource(
    isQuery ? 'query-alias' : 'table-alias',
    context => {
      if (isQuery) {
        context.render(parenthesize(sourceOrQuery))
      } else {
        context.render(sourceOrQuery)
      }
      context.append(' AS ')
      context.render(reference)
    },
    reference
  )

  const columnNames = isQuery
    ? Object.keys(sourceOrQuery.row)
    : Object.keys(sourceOrQuery.columns)
  const columns = Object.fromEntries(
    columnNames.map(columnName => [
      columnName,
      createColumnReference(columnName, reference) as ColumnReference<
        unknown,
        string,
        unknown
      >,
    ])
  )

  Object.assign(source, {
    alias: name,
    base: isQuery ? undefined : sourceOrQuery,
    query: isQuery ? sourceOrQuery : undefined,
    columns,
  })
  exposeColumns(source, columns)

  return source
}

export const as = alias
