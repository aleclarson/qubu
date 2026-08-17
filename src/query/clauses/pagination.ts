import { createClause, type SelectClause } from './types.ts'

export interface OffsetClause extends SelectClause<never, number> {
  readonly clauseKind: 'offset'
  readonly rows: number
}

export function offset(rows: number): OffsetClause {
  if (!Number.isInteger(rows) || rows < 0) {
    throw new RangeError('offset() requires a non-negative integer')
  }

  return Object.assign(
    createClause('offset', 'after-select', 90, context => {
      context.append('OFFSET ')
      context.parameter(rows)
      context.append(' ROWS')
    }),
    { clauseKind: 'offset' as const, rows }
  )
}

export interface FetchClause extends SelectClause<never, number> {
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
    createClause('fetch', 'after-select', 100, context => {
      context.append(`FETCH ${direction} `)
      context.parameter(rows)
      context.append(' ROWS ONLY')
    }),
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
