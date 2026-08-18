import { standardDialect } from '../dialects/standard.ts'
import type { Dialect } from './dialect.ts'
import type { AnyFragment, RenderContext } from './fragment.ts'

export interface RenderedQuery {
  readonly text: string
  readonly parameters: readonly unknown[]
}

export interface RenderOptions {
  readonly dialect?: Dialect
}

export function render(
  query: AnyFragment,
  options: RenderOptions | Dialect = {}
): RenderedQuery {
  const dialect = isDialect(options)
    ? options
    : (options.dialect ?? standardDialect())
  const parameters: unknown[] = []
  let text = ''

  const context: RenderContext = {
    dialect,
    append(value) {
      text += value
    },
    parameter(value) {
      parameters.push(value)
      text += dialect.placeholder(parameters.length)
    },
    render(part) {
      part.render(context)
    },
  }

  query.render(context)

  return Object.freeze({
    text,
    parameters: Object.freeze(parameters.slice()),
  })
}

export const toSql = render

function isDialect(value: RenderOptions | Dialect): value is Dialect {
  return 'placeholder' in value && 'quoteIdentifier' in value
}
