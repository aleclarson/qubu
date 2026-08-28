import type { CapabilityMetadataOf, RequiresOuterSourceMeta } from "../core/fragment.ts"
import { renderPagination, type AnyPaginationClause } from "./clauses/pagination.ts"
import type { AnySelectClause } from "./clauses/types.ts"
import { omit, type OmissionValidation, type PresentClauses, type SelectPart } from "./omit.ts"
import { renderSelection, selectionRow } from "./select/render.ts"
import type {
  NullableSources,
  RequiredOuterScope,
  SelectCardinality,
  GroupingValidation,
  ScopeValidation,
  SelectQuery,
} from "./select/types.ts"
import { validateClauses } from "./select/validate.ts"
import {
  type Selection,
  type SelectionOutput,
  type SelectionSqlTypes,
  selectionResultShape,
} from "./selection.ts"
import type { SelectionItems } from "./selection.ts"
import { createQuery } from "./types.ts"

type SelectMetadata<TSelection, TClauses extends readonly AnySelectClause[]> =
  | ([RequiredOuterScope<TSelection, TClauses>] extends [never]
      ? never
      : RequiresOuterSourceMeta<RequiredOuterScope<TSelection, TClauses>>)
  | CapabilityMetadataOf<SelectionItems<TSelection> | TClauses[number]>

export type {
  AvailableScope,
  AvailableOuterScope,
  ClauseScope,
  GroupingValidation,
  MissingScope,
  RequiredOuterScope,
  RequiredScope,
  SelectCardinality,
  ScopeValidation,
  SelectQuery,
} from "./select/types.ts"

export function select<
  const TSelection extends Selection,
  const TParts extends readonly SelectPart[],
  TClauses extends readonly AnySelectClause[] = PresentClauses<TParts>,
>(
  selection: TSelection,
  ...parts: TParts &
    OmissionValidation<TParts> &
    ScopeValidation<TSelection, TClauses> &
    GroupingValidation<TSelection, TClauses>
): SelectQuery<{
  readonly row: SelectionOutput<TSelection, NullableSources<TClauses>>
  readonly cardinality: SelectCardinality<TParts>
  readonly metadata: SelectMetadata<TSelection, TClauses>
  readonly sqlTypes: SelectionSqlTypes<
    TSelection,
    SelectionOutput<TSelection, NullableSources<TClauses>>
  >
}> {
  const normalizedClauses = parts.filter((part): part is AnySelectClause => part !== omit)

  validateClauses(normalizedClauses)

  const orderedClauses = normalizedClauses
    .map((clause, index) => ({
      clause,
      index,
    }))
    .sort((left, right) => left.clause.order - right.clause.order || left.index - right.index)
    .map(({ clause }) => clause)

  const row = selectionRow(selection) as SelectionOutput<TSelection, NullableSources<TClauses>>
  const query = createQuery<
    SelectionOutput<TSelection, NullableSources<TClauses>>,
    SelectCardinality<TParts>,
    SelectMetadata<TSelection, TClauses>,
    SelectionSqlTypes<TSelection, SelectionOutput<TSelection, NullableSources<TClauses>>>
  >("select", row, selectionResultShape(selection), (context) => {
    const beforeSelect = orderedClauses.filter((clause) => clause.placement === "before-select")
    const afterSelect = orderedClauses.filter((clause) => clause.placement === "after-select")
    const paginationClauses = afterSelect.filter(
      (clause): clause is AnyPaginationClause =>
        clause.clauseKind === "offset" || clause.clauseKind === "fetch",
    )
    let renderedPagination = false

    for (const clause of beforeSelect) {
      if (clause.clauseKind === "correlate") {
        continue
      }

      context.render(clause)
      context.append(" ")
    }

    context.append("SELECT ")
    const distinctClause = afterSelect.find((clause) => clause.clauseKind === "distinct")

    if (distinctClause) {
      context.render(distinctClause)
      context.append(" ")
    }

    renderSelection(selection, context)

    for (const clause of afterSelect) {
      if (clause.clauseKind === "correlate") {
        continue
      }

      if (clause === distinctClause) {
        continue
      }

      if (clause.clauseKind === "offset" || clause.clauseKind === "fetch") {
        if (renderedPagination) {
          continue
        }

        renderedPagination = true
        context.append(" ")
        renderPagination(context, paginationClauses)
        continue
      }

      context.append(" ")
      context.render(clause)
    }
  })

  return query as SelectQuery<{
    readonly row: SelectionOutput<TSelection, NullableSources<TClauses>>
    readonly cardinality: SelectCardinality<TParts>
    readonly metadata: SelectMetadata<TSelection, TClauses>
    readonly sqlTypes: SelectionSqlTypes<
      TSelection,
      SelectionOutput<TSelection, NullableSources<TClauses>>
    >
  }>
}
