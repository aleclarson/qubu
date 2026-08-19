import { createDialect, type PaginationPart } from '../core/dialect.ts'
import type { RenderContext } from '../core/fragment.ts'
import { mysqlJson } from './json.ts'

function renderMySqlPagination(
  context: RenderContext,
  parts: readonly PaginationPart[]
) {
  const fetch = parts.find(part => part.kind === 'fetch')
  const offset = parts.find(part => part.kind === 'offset')

  context.append('LIMIT ')
  if (fetch) context.parameter(fetch.rows)
  else context.append('18446744073709551615')
  if (offset) {
    context.append(' OFFSET ')
    context.parameter(offset.rows)
  }
}

export function mysqlDialect() {
  return createDialect({
    name: 'mysql',
    quoteIdentifier: identifier => `\`${identifier.replaceAll('`', '``')}\``,
    placeholder: () => '?',
    pagination: { render: renderMySqlPagination },
    json: mysqlJson,
  })
}
