import { fragment, type Fragment } from '../core/fragment.ts'

export type Row = Record<string, unknown>

export type QueryKind = 'select' | 'set' | 'insert' | 'update' | 'delete'

export interface Query<TRow extends object = Row, TParameters = never>
  extends Fragment<readonly TRow[], never, TParameters> {
  readonly queryKind: QueryKind
  readonly row: TRow
}

export type AnyQuery = Query<any, any>
export type QueryRow<T> = T extends Query<infer TRow, any> ? TRow : never

export function createQuery<TRow extends object, TParameters = never>(
  queryKind: QueryKind,
  row: TRow,
  render: Fragment['render']
): Query<TRow, TParameters> {
  return Object.freeze({
    queryKind,
    row,
    ...fragment<readonly TRow[], never, TParameters>(render),
  }) as Query<TRow, TParameters>
}
