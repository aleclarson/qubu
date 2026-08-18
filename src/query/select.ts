import { createQuery } from './types.ts'
import type { AnySelectClause } from './clauses/types.ts'
import { renderSelection, selectionRow } from './select/render.ts'
import { validateClauses } from './select/validate.ts'
import {
  renderPagination,
  type AnyPaginationClause,
} from './clauses/pagination.ts'
import type {
  NullableSources,
  SelectCardinality,
  GroupingValidation,
  ScopeValidation,
  SelectQuery,
} from './select/types.ts'
import { type Selection, type SelectionOutput } from './selection.ts'

export type {
  AvailableScope,
  ClauseScope,
  GroupingValidation,
  MissingScope,
  RequiredScope,
  SelectCardinality,
  ScopeValidation,
  SelectQuery,
} from './select/types.ts'

export function select<
  const TSelection extends Selection,
  const TClauses extends readonly AnySelectClause[],
>(
  selection: TSelection,
  ...clauses: TClauses &
    ScopeValidation<TSelection, TClauses> &
    GroupingValidation<TSelection, TClauses>
): SelectQuery<
  SelectionOutput<TSelection, NullableSources<TClauses>>,
  SelectCardinality<TClauses>
> {
  const normalizedClauses = clauses as readonly AnySelectClause[]
  validateClauses(normalizedClauses)

  const orderedClauses = normalizedClauses
    .map((clause, index) => ({ clause, index }))
    .sort(
      (left, right) =>
        left.clause.order - right.clause.order || left.index - right.index
    )
    .map(({ clause }) => clause)

  const row = selectionRow(selection) as SelectionOutput<
    TSelection,
    NullableSources<TClauses>
  >
  const query = createQuery<
    SelectionOutput<TSelection, NullableSources<TClauses>>,
    SelectCardinality<TClauses>
  >('select', row, context => {
    const beforeSelect = orderedClauses.filter(
      clause => clause.placement === 'before-select'
    )
    const afterSelect = orderedClauses.filter(
      clause => clause.placement === 'after-select'
    )
    const paginationClauses = afterSelect.filter(
      (clause): clause is AnyPaginationClause =>
        clause.clauseKind === 'offset' || clause.clauseKind === 'fetch'
    )
    let renderedPagination = false

    for (const clause of beforeSelect) {
      context.render(clause)
      context.append(' ')
    }

    context.append('SELECT ')
    const distinctClause = afterSelect.find(
      clause => clause.clauseKind === 'distinct'
    )
    if (distinctClause) {
      context.render(distinctClause)
      context.append(' ')
    }
    renderSelection(selection, context)

    for (const clause of afterSelect) {
      if (clause === distinctClause) continue
      if (clause.clauseKind === 'offset' || clause.clauseKind === 'fetch') {
        if (renderedPagination) continue
        renderedPagination = true
        context.append(' ')
        renderPagination(context, paginationClauses)
        continue
      }
      context.append(' ')
      context.render(clause)
    }
  })

  return query as SelectQuery<
    SelectionOutput<TSelection, NullableSources<TClauses>>,
    SelectCardinality<TClauses>
  >
}
