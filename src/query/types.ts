import {
  fragment,
  type CardinalityMeta,
  type Fragment,
  type QueryCardinality,
  type ResultMeta,
  type RenderFunction,
} from '../core/fragment.ts'
import type { SourceSqlTypes, UnknownSourceSqlTypes } from '../schema/source.ts'
import type { ResultShape } from '../result.ts'

export type Row = Record<string, unknown>

export type QueryKind = 'select' | 'set' | 'insert' | 'update' | 'delete'

export interface Query<
  TRow extends object = Row,
  TCardinality extends QueryCardinality = QueryCardinality,
  TMetadata = never,
  TSqlTypes = SourceSqlTypes<TRow>,
> extends Fragment<
    ResultMeta<readonly TRow[]> | CardinalityMeta<TCardinality> | TMetadata
  > {
  readonly queryKind: QueryKind
  readonly row: TRow
  /** Runtime metadata used to decode named result fields. */
  readonly resultShape: ResultShape
  /** Type-only SQL domains of the named query projection. */
  readonly sqlTypes?: TSqlTypes
}

export type AnyQuery = Query<any, any, any, any>
export type QueryRow<T> =
  T extends Query<infer TRow, any, any, any> ? TRow : never
/** Extract the field-to-SQL-domain map retained by a named query projection. */
export type QuerySqlTypeMap<T> =
  T extends Query<infer TRow, any, any, infer TSqlTypes>
    ? TSqlTypes & SourceSqlTypes<TRow>
    : never

export function createQuery<
  TRow extends object,
  TCardinality extends QueryCardinality = 'many',
  TMetadata = never,
  TSqlTypes = UnknownSourceSqlTypes<TRow>,
>(
  queryKind: QueryKind,
  row: TRow,
  resultShape: ResultShape,
  render: RenderFunction
): Query<TRow, TCardinality, TMetadata, TSqlTypes> {
  return Object.freeze({
    queryKind,
    row,
    resultShape,
    ...fragment<
      ResultMeta<readonly TRow[]> | CardinalityMeta<TCardinality> | TMetadata
    >(render),
  }) as Query<TRow, TCardinality, TMetadata, TSqlTypes>
}
