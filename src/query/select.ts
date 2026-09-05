import type {
  RenderContext,
  CapabilityMetadataOf,
  RequiresOuterSourceMeta,
} from "../core/fragment.ts"
import { snakeCaseIdentifier } from "../core/naming.ts"
import type { OrderByClause } from "./clauses/order-by.ts"
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
  >("select", row, selectionResultShape(selection), renderBody)

  function renderBody(
    context: RenderContext,
    extraOrdering?: {
      terms: OrderByClause["terms"]
      names: string[]
      hidden: boolean[]
    },
  ) {
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
    extraOrdering?.terms.forEach((term, index) => {
      if (!extraOrdering.hidden[index]) {
        return
      }

      context.append(", ")
      context.render(term.expression)
      context.append(" AS " + context.dialect.quoteIdentifier(extraOrdering.names[index]))
    })

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
      if (clause.clauseKind === "order-by" && extraOrdering) {
        context.append("ORDER BY ")
        extraOrdering.terms.forEach((term, index) => {
          if (index) {
            context.append(", ")
          }

          context.append(context.dialect.quoteIdentifier(extraOrdering.names[index]))
          if (term.direction) {
            context.append(` ${term.direction}`)
          }

          if (term.nulls) {
            context.append(` NULLS ${term.nulls}`)
          }
        })
      } else {
        context.render(clause)
      }
    }
  }

  return Object.freeze({
    ...query,
    cardinality: normalizedClauses.some(
      (clause) => clause.clauseKind === "fetch" && (clause as AnyPaginationClause).rows <= 1,
    )
      ? ("zero-or-one" as const)
      : normalizedClauses.every((clause) =>
            ["distinct", "order-by", "row-lock", "with"].includes(clause.clauseKind),
          )
        ? ("exactly-one" as const)
        : ("many" as const),
    renderJsonRows(context: RenderContext, ordinal: string) {
      const ordering = orderedClauses.find(
        (clause): clause is OrderByClause => clause.clauseKind === "order-by",
      )
      const terms = ordering?.terms ?? []

      if (
        orderedClauses.some((clause) => clause.clauseKind === "distinct") &&
        terms.some((term) => !Object.values(selection).includes(term.expression))
      ) {
        throw new TypeError("Nested JSON DISTINCT ordering must use selected expressions")
      }

      const occupied = new Set(Object.keys(row).map(snakeCaseIdentifier))

      occupied.add(ordinal)
      const hidden: boolean[] = []
      const names = terms.map((term, index) => {
        const selected = Object.entries(selection).find(
          ([, expression]) => expression === term.expression,
        )

        hidden.push(selected === undefined)
        if (selected) {
          return snakeCaseIdentifier(selected[0])
        }

        let name = `__qubu_json_sort_${index}`

        while (occupied.has(name)) {
          name += "_"
        }

        occupied.add(name)
        return name
      })
      const quote = context.dialect.quoteIdentifier

      context.append(`SELECT ${quote("__qubu_ordered")}.*, DENSE_RANK() OVER (`)
      if (terms.length) {
        context.append("ORDER BY ")
      }

      terms.forEach((term, index) => {
        if (index) {
          context.append(", ")
        }

        context.append(`${quote("__qubu_ordered")}.${quote(names[index])}`)
        if (term.direction) {
          context.append(` ${term.direction}`)
        }

        if (term.nulls) {
          context.append(` NULLS ${term.nulls}`)
        }
      })
      context.append(`) AS ${quote(ordinal)} FROM (`)
      renderBody(context, {
        terms,
        names,
        hidden,
      })
      context.append(`) AS ${quote("__qubu_ordered")}`)
    },
  }) as SelectQuery<{
    readonly row: SelectionOutput<TSelection, NullableSources<TClauses>>
    readonly cardinality: SelectCardinality<TParts>
    readonly metadata: SelectMetadata<TSelection, TClauses>
    readonly sqlTypes: SelectionSqlTypes<
      TSelection,
      SelectionOutput<TSelection, NullableSources<TClauses>>
    >
  }>
}
