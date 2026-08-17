import {
  fragment,
  type Fragment,
  type RenderContext,
} from '../../core/fragment.ts'

export type ClausePlacement = 'before-select' | 'after-select'

export interface SelectClause<TRequires = any, TParameters = any>
  extends Fragment<never, TRequires, TParameters> {
  readonly clauseKind: string
  readonly placement: ClausePlacement
  readonly order: number
}

export type AnySelectClause = SelectClause<any, any>

export function createClause<TRequires = never, TParameters = never>(
  clauseKind: string,
  placement: ClausePlacement,
  order: number,
  render: (context: RenderContext) => void
): SelectClause<TRequires, TParameters> {
  return {
    clauseKind,
    placement,
    order,
    ...fragment<never, TRequires, TParameters>(render),
  }
}
