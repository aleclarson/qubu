import { identifier } from '../core/primitives/identifier.ts'
import { resolveSqlNames } from '../core/naming.ts'
import { parenthesize } from '../core/fragment.ts'
import {
  createColumnReference,
  type ColumnReference,
} from '../expressions/column.ts'
import type { AnyQuery, Query } from '../query/types.ts'
import type {
  CapabilityMetadataOf,
  RequiresOuterMetadataOf,
} from '../core/fragment.ts'
import {
  createSource,
  exposeColumns,
  type Source,
  type SourceColumns,
  type SourceIdentity,
  type SourceRow,
  type SourceSqlTypeMap,
} from './source.ts'

export type AliasIdentity<TBase, TAlias extends string> = {
  readonly sourceKind: 'alias'
  readonly alias: TAlias
  readonly base: TBase
}

export type AliasedSource<
  TBase extends Source<any, any, any, any>,
  TAlias extends string,
> = Source<
  AliasIdentity<SourceIdentity<TBase>, TAlias>,
  SourceRow<TBase>,
  RequiresOuterMetadataOf<TBase> | CapabilityMetadataOf<TBase>,
  SourceSqlTypeMap<TBase>
> & {
  readonly alias: TAlias
  readonly base: TBase
  readonly columns: SourceColumns<
    SourceRow<TBase>,
    AliasIdentity<SourceIdentity<TBase>, TAlias>,
    SourceSqlTypeMap<TBase>
  >
} & SourceColumns<
    SourceRow<TBase>,
    AliasIdentity<SourceIdentity<TBase>, TAlias>,
    SourceSqlTypeMap<TBase>
  >

export type QueryAliasIdentity<TAlias extends string> = {
  readonly sourceKind: 'query-alias'
  readonly alias: TAlias
}

export type QuerySource<
  TRow extends object,
  TAlias extends string,
  TMetadata = never,
> = Source<QueryAliasIdentity<TAlias>, TRow, TMetadata> & {
  readonly alias: TAlias
  readonly query: Query<TRow, any, TMetadata>
  readonly columns: SourceColumns<TRow, QueryAliasIdentity<TAlias>>
} & SourceColumns<TRow, QueryAliasIdentity<TAlias>>

export function alias<
  TBase extends Source<any, any, any, any>,
  const TAlias extends string,
>(source: TBase, name: TAlias): AliasedSource<TBase, TAlias>
export function alias<TQuery extends AnyQuery, const TAlias extends string>(
  query: TQuery,
  name: TAlias
): QuerySource<
  import('../query/types.ts').QueryRow<TQuery>,
  TAlias,
  RequiresOuterMetadataOf<TQuery> | CapabilityMetadataOf<TQuery>
>
export function alias(
  sourceOrQuery: Source<any, any, any, any> | AnyQuery,
  name: string
) {
  const reference = identifier(name)
  const isQuery = 'queryKind' in sourceOrQuery
  const source = createSource(
    isQuery ? 'query-alias' : 'table-alias',
    context => {
      if (isQuery) {
        context.renderRelation(parenthesize(sourceOrQuery))
      } else {
        context.render(sourceOrQuery)
      }
      context.append(' AS ')
      context.render(reference)
    },
    reference
  )

  const fieldNames = isQuery
    ? Object.keys(sourceOrQuery.row)
    : Object.keys(sourceOrQuery.columns)
  const querySqlNames = isQuery
    ? resolveSqlNames(fieldNames.map(fieldName => ({ fieldName })))
    : undefined
  const columns = Object.fromEntries(
    fieldNames.map(fieldName => {
      const columnName = isQuery
        ? querySqlNames![fieldName]
        : sourceOrQuery.columns[fieldName].columnName
      return [
        fieldName,
        createColumnReference(
          columnName,
          reference,
          fieldName
        ) as ColumnReference<string, any>,
      ]
    })
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

export type LateralIdentity<TAlias extends string> = {
  readonly sourceKind: 'lateral'
  readonly alias: TAlias
}

export type LateralSource<
  TQuery extends AnyQuery,
  TAlias extends string,
> = Source<
  LateralIdentity<TAlias>,
  import('../query/types.ts').QueryRow<TQuery>,
  RequiresOuterMetadataOf<TQuery> | CapabilityMetadataOf<TQuery>
> & {
  readonly alias: TAlias
  readonly query: TQuery
  readonly columns: SourceColumns<
    import('../query/types.ts').QueryRow<TQuery>,
    LateralIdentity<TAlias>
  >
} & SourceColumns<
    import('../query/types.ts').QueryRow<TQuery>,
    LateralIdentity<TAlias>
  >

/** Render a query as a LATERAL source whose outer requirements stay visible. */
export function lateral<TQuery extends AnyQuery, const TAlias extends string>(
  query: TQuery,
  name: TAlias
): LateralSource<TQuery, TAlias> {
  type TRow = import('../query/types.ts').QueryRow<TQuery>
  type TIdentity = LateralIdentity<TAlias>
  const reference = identifier(name)
  const source = createSource<
    TIdentity,
    TRow,
    RequiresOuterMetadataOf<TQuery> | CapabilityMetadataOf<TQuery>
  >(
    'lateral',
    context => {
      context.append('LATERAL ')
      context.renderRelation(parenthesize(query))
      context.append(' AS ')
      context.render(reference)
    },
    reference
  )

  const sqlNames = resolveSqlNames(
    Object.keys(query.row).map(fieldName => ({ fieldName }))
  )
  const columns = Object.fromEntries(
    Object.keys(query.row).map(fieldName => [
      fieldName,
      createColumnReference(
        sqlNames[fieldName],
        reference,
        fieldName
      ) as ColumnReference<string, any>,
    ])
  ) as SourceColumns<TRow, TIdentity>

  Object.assign(source, {
    alias: name,
    query,
    columns,
  })
  exposeColumns(source, columns)

  return source as LateralSource<TQuery, TAlias>
}
