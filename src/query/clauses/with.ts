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
import {
  createQuery,
  type Query,
  type QueryRow,
  type QuerySqlTypeMap,
} from '../types.ts'
import type { SelectQuery } from '../select/types.ts'
import type { SetSqlValidation } from '../set.ts'
import type { QueryTypeValidation } from '../errors.ts'
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
  TSqlTypes extends
    import('../../schema/source.ts').SourceSqlTypes<TRow> = import('../../schema/source.ts').UnknownSourceSqlTypes<TRow>,
> = Source<CteIdentity<TName>, TRow, TMetadata, TSqlTypes> & {
  readonly cteName: TName
  readonly query: Query<TRow, any, TMetadata, TSqlTypes>
  readonly columns: SourceColumns<TRow, CteIdentity<TName>, TSqlTypes>
} & SourceColumns<TRow, CteIdentity<TName>, TSqlTypes>

type CteMetadata<TQuery extends Query<any, any, any, any>> =
  | RequiresOuterMetadataOf<TQuery>
  | CapabilityMetadataOf<TQuery>

type IsUnknown<T> = unknown extends T
  ? [keyof T] extends [never]
    ? true
    : false
  : false

type RecursiveMemberFieldFailures<TAnchor, TMember> =
  | Exclude<keyof QueryRow<TAnchor>, keyof QueryRow<TMember>>
  | Exclude<keyof QueryRow<TMember>, keyof QueryRow<TAnchor>>
  | {
      [K in keyof QueryRow<TAnchor> & keyof QueryRow<TMember>]: [
        IsUnknown<QueryRow<TMember>[K]>,
      ] extends [true]
        ? never
        : [IsUnknown<QueryRow<TAnchor>[K]>] extends [true]
          ? never
          : [QueryRow<TMember>[K]] extends [QueryRow<TAnchor>[K]]
            ? never
            : K
    }[keyof QueryRow<TAnchor> & keyof QueryRow<TMember>]

type RecursiveMemberShapeValidation<TAnchor, TMember> = [
  RecursiveMemberFieldFailures<TAnchor, TMember>,
] extends [never]
  ? unknown
  : QueryTypeValidation<
      'incompatible-set-domain',
      'recursive-cte.member',
      'The recursive member must expose the anchor fields with compatible application types.',
      RecursiveMemberFieldFailures<TAnchor, TMember>
    >

type RecursiveMemberValidation<TAnchor, TMember> =
  RecursiveMemberShapeValidation<TAnchor, TMember> &
    SetSqlValidation<TAnchor, TMember>

type RecursiveCteSelf<
  TName extends string,
  TAnchor extends SelectQuery<any, any, any, any>,
> = CteSource<
  TName,
  QueryRow<TAnchor>,
  CteMetadata<TAnchor>,
  QuerySqlTypeMap<TAnchor>
>

/** The typed source returned by {@link recursiveCte}. */
export type RecursiveCteSource<
  TName extends string,
  TAnchor extends SelectQuery<any, any, any, any>,
  TMember extends SelectQuery<any, any, any, any>,
> = CteSource<
  TName,
  QueryRow<TAnchor>,
  CteMetadata<TAnchor | TMember>,
  QuerySqlTypeMap<TAnchor>
>

type RecursiveCteQuery<TRow extends object, TMetadata, TSqlTypes> = Query<
  TRow,
  'many',
  TMetadata,
  TSqlTypes
> & {
  readonly recursive: true
}

export type AnyCteSource = Source<any, any, any, any, any> & {
  readonly cteName: string
  readonly query: Query<any, any, any> & { readonly recursive?: boolean }
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
  RequiresOuterMetadataOf<TQuery> | CapabilityMetadataOf<TQuery>,
  QuerySqlTypeMap<TQuery>
> {
  type TRow = QueryRow<TQuery>
  type TIdentity = CteIdentity<TName>
  type TMetadata =
    | RequiresOuterMetadataOf<TQuery>
    | CapabilityMetadataOf<TQuery>
  type TSqlTypes = QuerySqlTypeMap<TQuery>
  const reference = identifier(name)
  const source = createSource<TIdentity, TRow, TMetadata, TSqlTypes>(
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
  ) as SourceColumns<TRow, TIdentity, TSqlTypes>

  Object.assign(source, {
    cteName: name,
    query,
    columns,
  })
  exposeColumns(source, columns)

  return source as CteSource<TName, TRow, TMetadata, TSqlTypes>
}

/**
 * Define a typed recursive `WITH` source from an anchor and one recursive
 * member. The callback receives a forward reference that must be introduced
 * through the member query's normal FROM or JOIN scope.
 */
export function recursiveCte<
  const TName extends string,
  TAnchor extends SelectQuery<any, any, any, any>,
  TMember extends SelectQuery<any, any, any, any>,
>(
  name: TName,
  anchor: TAnchor,
  member: ((self: RecursiveCteSelf<TName, TAnchor>) => TMember) &
    ((
      self: RecursiveCteSelf<TName, TAnchor>
    ) => TMember &
      RecursiveMemberValidation<NoInfer<TAnchor>, NoInfer<TMember>>)
): RecursiveCteSource<TName, TAnchor, TMember> {
  type TRow = QueryRow<TAnchor>
  type TIdentity = CteIdentity<TName>
  type TMetadata = CteMetadata<TAnchor | TMember>
  type TSqlTypes = QuerySqlTypeMap<TAnchor>
  const reference = identifier(name)
  const source = createSource<TIdentity, TRow, CteMetadata<TAnchor>, TSqlTypes>(
    'cte',
    context => context.render(reference),
    reference
  )
  const sqlNames = resolveSqlNames(
    Object.keys(anchor.row).map(fieldName => ({ fieldName }))
  )
  const columns = Object.fromEntries(
    Object.keys(anchor.row).map(fieldName => [
      fieldName,
      createColumnReference(
        sqlNames[fieldName],
        reference,
        fieldName
      ) as ColumnReference<string, any>,
    ])
  ) as SourceColumns<TRow, TIdentity, TSqlTypes>

  Object.assign(source, {
    cteName: name,
    query: anchor,
    columns,
  })
  exposeColumns(source, columns)

  const memberQuery = member(source as RecursiveCteSelf<TName, TAnchor>)
  const query = Object.freeze({
    ...createQuery<TRow, 'many', TMetadata, TSqlTypes>(
      'set',
      anchor.row,
      context => {
        context.render(anchor)
        context.append(' UNION ALL ')
        context.render(memberQuery)
      }
    ),
    recursive: true as const,
  }) as RecursiveCteQuery<TRow, TMetadata, TSqlTypes>

  Object.assign(source, {
    query,
  })

  return source as unknown as RecursiveCteSource<TName, TAnchor, TMember>
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
      context.append(
        ctes.some(entry => entry.query.recursive) ? 'WITH RECURSIVE ' : 'WITH '
      )
      ctes.forEach((entry, index) => {
        if (index > 0) context.append(', ')
        context.render(identifier(entry.cteName))
        if (entry.query.recursive) {
          const sqlNames = resolveSqlNames(
            Object.keys(entry.query.row).map(fieldName => ({ fieldName }))
          )
          context.append(' (')
          Object.keys(entry.query.row).forEach((fieldName, columnIndex) => {
            if (columnIndex > 0) context.append(', ')
            context.render(identifier(sqlNames[fieldName]))
          })
          context.append(')')
        }
        context.append(' AS ')
        context.renderRelation(parenthesize(entry.query))
      })
    }),
    { clauseKind: 'with' as const, ctes }
  ) as WithClause<TMetadata>
}
