import type { Fragment, RenderContext } from "../../core/fragment.ts"
import type { ResultShape } from "../../result.ts"
import { renderSelection, selectionRow } from "../select/render.ts"
import {
  selectionResultShape,
  type Selection,
  type SelectionMetadata,
  type SelectionOutput,
  type SelectionSqlTypes,
} from "../selection.ts"

export interface ReturningClause<TSelection extends Selection = Selection> extends Fragment<
  SelectionMetadata<TSelection>
> {
  readonly clauseKind: "returning"
  readonly selection: TSelection
  readonly row: SelectionOutput<TSelection>
  readonly resultShape: ResultShape
}

export type ReturningRow<T> = [T] extends [ReturningClause<infer TSelection>]
  ? SelectionOutput<TSelection>
  : Record<string, never>

/** SQL semantic domains retained by a mutation RETURNING projection. */
export type ReturningSqlTypes<T> = [T] extends [ReturningClause<infer TSelection>]
  ? SelectionSqlTypes<TSelection>
  : Record<string, never>

export function returning<const TSelection extends Selection>(
  selection: TSelection,
): ReturningClause<TSelection> {
  return Object.freeze({
    clauseKind: "returning" as const,
    selection,
    row: selectionRow(selection) as SelectionOutput<TSelection>,
    resultShape: selectionResultShape(selection),
    render(context: RenderContext) {
      context.append("RETURNING ")
      renderSelection(selection, context)
    },
  })
}
