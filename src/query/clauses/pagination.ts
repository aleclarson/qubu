import type { PaginationPart } from "../../core/dialect.ts"
import type { RenderContext } from "../../core/fragment.ts"
import { queryValidationError } from "../errors.ts"
import { createClause, type SelectClause } from "./types.ts"

export interface OffsetClause extends SelectClause<never> {
  readonly clauseKind: "offset"
  readonly rows: number
}

export type AnyPaginationClause = OffsetClause | FetchClause

function toPaginationPart(clause: AnyPaginationClause): PaginationPart {
  return clause.clauseKind === "offset"
    ? {
        kind: "offset",
        rows: clause.rows,
      }
    : {
        kind: "fetch",
        rows: clause.rows,
        direction: clause.direction,
      }
}

export function renderPagination(context: RenderContext, clauses: readonly AnyPaginationClause[]) {
  const parts = clauses.map(toPaginationPart)

  if (context.dialect.pagination) {
    context.dialect.pagination.render(context, parts)
    return
  }

  parts.forEach((part, index) => {
    if (index > 0) {
      context.append(" ")
    }

    if (part.kind === "offset") {
      context.append("OFFSET ")
      context.parameter(part.rows, "integer")
      context.append(" ROWS")
    } else {
      context.append(`FETCH ${part.direction} `)
      context.parameter(part.rows, "integer")
      context.append(" ROWS ONLY")
    }
  })
}

export function offset(rows: number): OffsetClause {
  if (!Number.isInteger(rows) || rows < 0) {
    throw queryValidationError({
      code: "invalid-pagination",
      context: "select.pagination.offset",
      path: ["offset"],
      message: "offset() requires a non-negative integer",
      hint: "Pass a non-negative integer row count.",
    })
  }

  return Object.assign(
    createClause("offset", "after-select", 90, (context) =>
      renderPagination(context, [
        {
          clauseKind: "offset",
          rows,
        } as OffsetClause,
      ]),
    ),
    {
      clauseKind: "offset" as const,
      rows,
    },
  )
}

export interface FetchClause<TRows extends number = number> extends SelectClause<never> {
  readonly clauseKind: "fetch"
  readonly direction: "FIRST" | "NEXT"
  readonly rows: TRows
}

function fetchRows<const TRows extends number>(
  direction: FetchClause["direction"],
  rows: TRows,
): FetchClause<TRows> {
  if (!Number.isInteger(rows) || rows < 0) {
    throw queryValidationError({
      code: "invalid-pagination",
      context: `select.pagination.fetch${direction === "FIRST" ? "First" : "Next"}`,
      path: ["fetch", direction],
      message: "fetch rows require a non-negative integer",
      hint: "Pass a non-negative integer row count.",
    })
  }

  return Object.assign(
    createClause("fetch", "after-select", 100, (context) =>
      renderPagination(context, [
        {
          clauseKind: "fetch",
          direction,
          rows,
        } as unknown as FetchClause<TRows>,
      ]),
    ),
    {
      clauseKind: "fetch" as const,
      direction,
      rows,
    },
  ) as FetchClause<TRows>
}

export function fetchFirst<const TRows extends number>(rows: TRows) {
  return fetchRows("FIRST", rows)
}

export function fetchNext<const TRows extends number>(rows: TRows) {
  return fetchRows("NEXT", rows)
}
