import {
  fragment,
  type CardinalityMeta,
  type Fragment,
  type QueryCardinality,
  type ResultMeta,
  type RenderFunction,
} from '../core/fragment.ts'

export type Row = Record<string, unknown>

export type QueryKind = 'select' | 'set' | 'insert' | 'update' | 'delete'

export interface Query<
  TRow extends object = Row,
  TCardinality extends QueryCardinality = QueryCardinality,
  TMetadata = never,
> extends Fragment<
    ResultMeta<readonly TRow[]> | CardinalityMeta<TCardinality> | TMetadata
  > {
  readonly queryKind: QueryKind
  readonly row: TRow
}

export type AnyQuery = Query<any, any, any>
export type QueryRow<T> = T extends Query<infer TRow, any, any> ? TRow : never

export function createQuery<
  TRow extends object,
  TCardinality extends QueryCardinality = 'many',
  TMetadata = never,
>(
  queryKind: QueryKind,
  row: TRow,
  render: RenderFunction
): Query<TRow, TCardinality, TMetadata> {
  return Object.freeze({
    queryKind,
    row,
    ...fragment<
      ResultMeta<readonly TRow[]> | CardinalityMeta<TCardinality> | TMetadata
    >(render),
  }) as Query<TRow, TCardinality, TMetadata>
}
