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
> extends Fragment<
    ResultMeta<readonly TRow[]> | CardinalityMeta<TCardinality>
  > {
  readonly queryKind: QueryKind
  readonly row: TRow
}

export type AnyQuery = Query<any, any>
export type QueryRow<T> = T extends Query<infer TRow, any> ? TRow : never

export function createQuery<
  TRow extends object,
  TCardinality extends QueryCardinality = 'many',
>(
  queryKind: QueryKind,
  row: TRow,
  render: RenderFunction
): Query<TRow, TCardinality> {
  return Object.freeze({
    queryKind,
    row,
    ...fragment<ResultMeta<readonly TRow[]> | CardinalityMeta<TCardinality>>(
      render
    ),
  }) as Query<TRow, TCardinality>
}
