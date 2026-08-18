import type { RenderContext } from '../../core/fragment.ts'
import type { PaginationPart } from '../../core/dialect.ts'
import { createClause, type SelectClause } from './types.ts'

export interface OffsetClause extends SelectClause<never> {
  readonly clauseKind: 'offset'
  readonly rows: number
}

export type AnyPaginationClause = OffsetClause | FetchClause

function toPaginationPart(clause: AnyPaginationClause): PaginationPart {
  return clause.clauseKind === 'offset'
    ? { kind: 'offset', rows: clause.rows }
    : { kind: 'fetch', rows: clause.rows, direction: clause.direction }
}

export function renderPagination(
  context: RenderContext,
  clauses: readonly AnyPaginationClause[]
) {
  const parts = clauses.map(toPaginationPart)
  if (context.dialect.pagination) {
    context.dialect.pagination.render(context, parts)
    return
  }

  parts.forEach((part, index) => {
    if (index > 0) context.append(' ')
    if (part.kind === 'offset') {
      context.append('OFFSET ')
      context.parameter(part.rows)
      context.append(' ROWS')
    } else {
      context.append(`FETCH ${part.direction} `)
      context.parameter(part.rows)
      context.append(' ROWS ONLY')
    }
  })
}

export function offset(rows: number): OffsetClause {
  if (!Number.isInteger(rows) || rows < 0) {
    throw new RangeError('offset() requires a non-negative integer')
  }

  return Object.assign(
    createClause('offset', 'after-select', 90, context =>
      renderPagination(context, [
        { clauseKind: 'offset', rows } as OffsetClause,
      ])
    ),
    { clauseKind: 'offset' as const, rows }
  )
}

export interface FetchClause extends SelectClause<never> {
  readonly clauseKind: 'fetch'
  readonly direction: 'FIRST' | 'NEXT'
  readonly rows: number
}

function fetchRows(
  direction: FetchClause['direction'],
  rows: number
): FetchClause {
  if (!Number.isInteger(rows) || rows < 0) {
    throw new RangeError('fetch rows require a non-negative integer')
  }

  return Object.assign(
    createClause('fetch', 'after-select', 100, context =>
      renderPagination(context, [
        { clauseKind: 'fetch', direction, rows } as FetchClause,
      ])
    ),
    { clauseKind: 'fetch' as const, direction, rows }
  )
}

export function fetchFirst(rows: number) {
  return fetchRows('FIRST', rows)
}

export function fetchNext(rows: number) {
  return fetchRows('NEXT', rows)
}

export const limit = fetchFirst
