import {
  parenthesize,
  type CapabilityMetadataOf,
  type RequiresOuterMetadataOf,
} from '../../core/fragment.ts'
import { identifier } from '../../core/primitives/identifier.ts'
import { resolveSqlNames } from '../../core/naming.ts'
import {
  createColumnReference,
  type ColumnReference,
} from '../../expressions/column.ts'
import type { Query, QueryRow } from '../types.ts'
import {
  createSource,
  exposeColumns,
  type Source,
  type SourceColumns,
} from '../../schema/source.ts'
import { createClause, type SelectClause } from './types.ts'

export type CteIdentity<TName extends string> = {
  readonly sourceKind: 'cte'
  readonly name: TName
}

export type CteSource<
  TName extends string,
  TRow extends object,
  TMetadata = never,
> = Source<CteIdentity<TName>, TRow, TMetadata> & {
  readonly cteName: TName
  readonly query: Query<TRow, any, TMetadata>
  readonly columns: SourceColumns<TRow, CteIdentity<TName>>
} & SourceColumns<TRow, CteIdentity<TName>>

export type AnyCteSource = Source<any, any, any> & {
  readonly cteName: string
  readonly query: Query<any, any, any>
  readonly columns: Record<string, unknown>
}

export function cte<
  const TName extends string,
  TQuery extends Query<any, any, any>,
>(
  name: TName,
  query: TQuery
): CteSource<
  TName,
  QueryRow<TQuery>,
  RequiresOuterMetadataOf<TQuery> | CapabilityMetadataOf<TQuery>
> {
  type TRow = QueryRow<TQuery>
  type TIdentity = CteIdentity<TName>
  type TMetadata =
    | RequiresOuterMetadataOf<TQuery>
    | CapabilityMetadataOf<TQuery>
  const reference = identifier(name)
  const source = createSource<TIdentity, TRow, TMetadata>(
    'cte',
    context => context.render(reference),
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
    cteName: name,
    query,
    columns,
  })
  exposeColumns(source, columns)

  return source as CteSource<TName, TRow, TMetadata>
}

export interface WithClause<TMetadata = never> extends SelectClause<TMetadata> {
  readonly clauseKind: 'with'
  readonly ctes: readonly AnyCteSource[]
}

export function withCte<const TCtes extends readonly AnyCteSource[]>(
  ...ctes: TCtes
): WithClause<
  RequiresOuterMetadataOf<TCtes[number]> | CapabilityMetadataOf<TCtes[number]>
> {
  type TMetadata =
    | RequiresOuterMetadataOf<TCtes[number]>
    | CapabilityMetadataOf<TCtes[number]>
  return Object.assign(
    createClause<TMetadata>('with', 'before-select', 10, context => {
      context.append('WITH ')
      ctes.forEach((entry, index) => {
        if (index > 0) context.append(', ')
        context.render(identifier(entry.cteName))
        context.append(' AS ')
        context.renderRelation(parenthesize(entry.query))
      })
    }),
    { clauseKind: 'with' as const, ctes }
  ) as WithClause<TMetadata>
}

export const withQueries = withCte
