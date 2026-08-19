import { createDialect, type PaginationPart } from '../core/dialect.ts'
import type { RenderContext } from '../core/fragment.ts'
import { sqliteJson } from './json.ts'

function renderSqlitePagination(
  context: RenderContext,
  parts: readonly PaginationPart[]
) {
  const fetch = parts.find(part => part.kind === 'fetch')
  const offset = parts.find(part => part.kind === 'offset')

  context.append('LIMIT ')
  if (fetch) context.parameter(fetch.rows)
  else context.append('-1')
  if (offset) {
    context.append(' OFFSET ')
    context.parameter(offset.rows)
  }
}

export function sqliteDialect() {
  return createDialect({
    name: 'sqlite',
    placeholder: () => '?',
    pagination: { render: renderSqlitePagination },
    json: sqliteJson,
    castTypes: {
      decimal: 'NUMERIC',
      boolean: 'INTEGER',
      date: 'TEXT',
      timestamp: 'TEXT',
      uuid: 'TEXT',
      json: 'TEXT',
      binary: 'BLOB',
    },
  })
}
