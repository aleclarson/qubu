import {
  fragment,
  type Fragment,
  type RenderFunction,
} from '../core/fragment.ts'

export type Row = Record<string, unknown>

export type QueryKind = 'select' | 'set' | 'insert' | 'update' | 'delete'

export interface Query<TRow extends object = Row>
  extends Fragment<import('../core/fragment.ts').ResultMeta<readonly TRow[]>> {
  readonly queryKind: QueryKind
  readonly row: TRow
}

export type AnyQuery = Query<any>
export type QueryRow<T> = T extends Query<infer TRow> ? TRow : never

export function createQuery<TRow extends object>(
  queryKind: QueryKind,
  row: TRow,
  render: RenderFunction
): Query<TRow> {
  return Object.freeze({
    queryKind,
    row,
    ...fragment<import('../core/fragment.ts').ResultMeta<readonly TRow[]>>(
      render
    ),
  }) as Query<TRow>
}
