import { createQuery } from './types.ts'
import type { AnySelectClause } from './clauses/types.ts'
import { renderSelection, selectionRow } from './select/render.ts'
import { validateClauses } from './select/validate.ts'
import type {
  ScopeValidation,
  SelectParameters,
  SelectQuery,
} from './select/types.ts'
import { type Selection, type SelectionOutput } from './selection.ts'

export type {
  AvailableScope,
  ClauseScope,
  MissingScope,
  RequiredScope,
  ScopeValidation,
  SelectQuery,
} from './select/types.ts'

export function select<
  const TSelection extends Selection,
  const TClauses extends readonly AnySelectClause[],
>(
  selection: TSelection,
  ...clauses: TClauses & ScopeValidation<TSelection, TClauses>
): SelectQuery<
  SelectionOutput<TSelection>,
  SelectParameters<TSelection, TClauses>
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

  const row = selectionRow(selection)
  const query = createQuery('select', row, context => {
    const beforeSelect = orderedClauses.filter(
      clause => clause.placement === 'before-select'
    )
    const afterSelect = orderedClauses.filter(
      clause => clause.placement === 'after-select'
    )

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
      context.append(' ')
      context.render(clause)
    }
  })

  return query as SelectQuery<
    SelectionOutput<TSelection>,
    SelectParameters<TSelection, TClauses>
  >
}
