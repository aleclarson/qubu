import type { Fragment, RenderContext } from '../../core/fragment.ts'
import { renderSelection, selectionRow } from '../select/render.ts'
import type {
  Selection,
  SelectionOutput,
  SelectionParameters,
  SelectionRequires,
} from '../selection.ts'

export interface ReturningClause<TSelection extends Selection = Selection>
  extends Fragment<
    never,
    SelectionRequires<TSelection>,
    SelectionParameters<TSelection>
  > {
  readonly clauseKind: 'returning'
  readonly selection: TSelection
  readonly row: SelectionOutput<TSelection>
}

export type ReturningRow<T> = [T] extends [ReturningClause<infer TSelection>]
  ? SelectionOutput<TSelection>
  : Record<string, never>

export function returning<const TSelection extends Selection>(
  selection: TSelection
): ReturningClause<TSelection> {
  return Object.freeze({
    clauseKind: 'returning' as const,
    selection,
    row: selectionRow(selection) as SelectionOutput<TSelection>,
    render(context: RenderContext) {
      context.append('RETURNING ')
      renderSelection(selection, context)
    },
  })
}
