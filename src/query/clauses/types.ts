import {
  fragment,
  type Fragment,
  type RenderContext,
} from '../../core/fragment.ts'

export type ClausePlacement = 'before-select' | 'after-select'

export interface SelectClause<TMetadata = any> extends Fragment<TMetadata> {
  readonly clauseKind: string
  readonly placement: ClausePlacement
  readonly order: number
}

export type AnySelectClause = SelectClause<any>

export function createClause<TMetadata = never>(
  clauseKind: string,
  placement: ClausePlacement,
  order: number,
  render: (context: RenderContext) => void
): SelectClause<TMetadata> {
  return {
    clauseKind,
    placement,
    order,
    ...fragment<TMetadata>(render),
  }
}
