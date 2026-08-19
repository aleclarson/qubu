import { identifier } from '../core/primitives/identifier.ts'
import { resolveSqlNames } from '../core/naming.ts'
import { parenthesize } from '../core/fragment.ts'
import {
  createColumnReference,
  type ColumnReference,
} from '../expressions/column.ts'
import type { AnyQuery, Query, QuerySqlTypeMap } from '../query/types.ts'
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
  type SourceConstraints,
  type SourceRow,
  type SourceSqlTypeMap,
} from './source.ts'
import type { SourceIndexesRecord } from './indexes.ts'

type SourceIndexes<T> = T extends {
  readonly indexes: infer TIndexes extends SourceIndexesRecord
}
  ? TIndexes
  : {}

export type AliasIdentity<TBase, TAlias extends string> = {
  readonly sourceKind: 'alias'
  readonly alias: TAlias
  readonly base: TBase
}

export type AliasedSource<
  TBase extends Source<any, any, any, any, any>,
  TAlias extends string,
> = Source<
  AliasIdentity<SourceIdentity<TBase>, TAlias>,
  SourceRow<TBase>,
  RequiresOuterMetadataOf<TBase> | CapabilityMetadataOf<TBase>,
  SourceSqlTypeMap<TBase>,
  SourceConstraints<TBase>
> & {
  readonly alias: TAlias
  readonly base: TBase
  readonly columns: SourceColumns<
    SourceRow<TBase>,
    AliasIdentity<SourceIdentity<TBase>, TAlias>,
    SourceSqlTypeMap<TBase>
  >
  readonly constraints: SourceConstraints<TBase>
  readonly indexes: SourceIndexes<TBase>
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
  TSqlTypes extends
    import('./source.ts').SourceSqlTypes<TRow> = import('./source.ts').UnknownSourceSqlTypes<TRow>,
> = Source<QueryAliasIdentity<TAlias>, TRow, TMetadata, TSqlTypes> & {
  readonly alias: TAlias
  readonly query: Query<TRow, any, TMetadata, TSqlTypes>
  readonly columns: SourceColumns<TRow, QueryAliasIdentity<TAlias>, TSqlTypes>
} & SourceColumns<TRow, QueryAliasIdentity<TAlias>, TSqlTypes>

export function alias<
  TBase extends Source<any, any, any, any, any>,
  const TAlias extends string,
>(source: TBase, name: TAlias): AliasedSource<TBase, TAlias>
export function alias<TQuery extends AnyQuery, const TAlias extends string>(
  query: TQuery,
  name: TAlias
): QuerySource<
  import('../query/types.ts').QueryRow<TQuery>,
  TAlias,
  RequiresOuterMetadataOf<TQuery> | CapabilityMetadataOf<TQuery>,
  QuerySqlTypeMap<TQuery>
>
export function alias(sourceOrQuery: unknown, name: string): unknown {
  const input = sourceOrQuery as Source<any, any, any, any, any> | AnyQuery
  const reference = identifier(name)
  const isQuery = 'queryKind' in input
  const source = createSource(
    isQuery ? 'query-alias' : 'table-alias',
    context => {
      if (isQuery) {
        context.renderRelation(parenthesize(input))
      } else {
        context.render(input)
      }
      context.append(' AS ')
      context.render(reference)
    },
    reference
  )

  const fieldNames = isQuery
    ? Object.keys(input.row)
    : Object.keys(input.columns)
  const querySqlNames = isQuery
    ? resolveSqlNames(fieldNames.map(fieldName => ({ fieldName })))
    : undefined
  const columns = Object.fromEntries(
    fieldNames.map(fieldName => {
      const columnName = isQuery
        ? querySqlNames![fieldName]
        : input.columns[fieldName].columnName
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
    base: isQuery ? undefined : input,
    query: isQuery ? input : undefined,
    constraints: isQuery ? {} : input.constraints,
    indexes: isQuery ? {} : 'indexes' in input ? input.indexes : {},
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
  RequiresOuterMetadataOf<TQuery> | CapabilityMetadataOf<TQuery>,
  QuerySqlTypeMap<TQuery>
> & {
  readonly alias: TAlias
  readonly query: TQuery
  readonly columns: SourceColumns<
    import('../query/types.ts').QueryRow<TQuery>,
    LateralIdentity<TAlias>,
    QuerySqlTypeMap<TQuery>
  >
} & SourceColumns<
    import('../query/types.ts').QueryRow<TQuery>,
    LateralIdentity<TAlias>,
    QuerySqlTypeMap<TQuery>
  >

/** Render a query as a LATERAL source whose outer requirements stay visible. */
export function lateral<TQuery extends AnyQuery, const TAlias extends string>(
  query: TQuery,
  name: TAlias
): LateralSource<TQuery, TAlias> {
  type TRow = import('../query/types.ts').QueryRow<TQuery>
  type TIdentity = LateralIdentity<TAlias>
  type TSqlTypes = QuerySqlTypeMap<TQuery>
  const reference = identifier(name)
  const source = createSource<
    TIdentity,
    TRow,
    RequiresOuterMetadataOf<TQuery> | CapabilityMetadataOf<TQuery>,
    TSqlTypes
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
  ) as SourceColumns<TRow, TIdentity, TSqlTypes>

  Object.assign(source, {
    alias: name,
    query,
    columns,
  })
  exposeColumns(source, columns)

  return source as LateralSource<TQuery, TAlias>
}
