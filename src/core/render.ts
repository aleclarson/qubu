import { standardDialect } from "../dialects/standard.ts"
import type { QueryTypeValidation } from "../query/errors.ts"
import type { Dialect, DialectCapability } from "./dialect.ts"
import type { AnyFragment, CapabilitiesOf, RenderContext } from "./fragment.ts"

type DefaultDialectCapability = "json"

export interface RenderedQuery {
  readonly text: string
  readonly parameters: readonly unknown[]
}

export interface RenderOptions<TCapabilities extends DialectCapability = DialectCapability> {
  readonly dialect?: Dialect<TCapabilities>
}

type IsAny<T> = 0 extends 1 & T ? true : false

type MissingCapabilities<TQuery, TCapabilities extends DialectCapability> =
  IsAny<CapabilitiesOf<TQuery>> extends true
    ? never
    : Exclude<CapabilitiesOf<TQuery>, TCapabilities>

export type RenderCapabilityValidation<TQuery, TCapabilities extends DialectCapability> = [
  MissingCapabilities<TQuery, TCapabilities>,
] extends [never]
  ? unknown
  : QueryTypeValidation<
      "missing-dialect-capability",
      "render.dialect",
      "Provide a dialect that supports every capability required by the query.",
      MissingCapabilities<TQuery, TCapabilities>
    >

export function render<TQuery extends AnyFragment>(
  query: TQuery & RenderCapabilityValidation<TQuery, DefaultDialectCapability>,
): RenderedQuery
export function render<TQuery extends AnyFragment, TCapabilities extends DialectCapability>(
  query: TQuery & RenderCapabilityValidation<TQuery, TCapabilities>,
  options: RenderOptions<TCapabilities> | Dialect<TCapabilities>,
): RenderedQuery
export function render(query: AnyFragment, options: RenderOptions | Dialect = {}): RenderedQuery {
  const dialect = isDialect(options) ? options : (options.dialect ?? standardDialect())
  const parameters: unknown[] = []
  let text = ""
  let projectionMode: RenderContext["projectionMode"] = "result"

  const context: RenderContext = {
    dialect,
    get projectionMode() {
      return projectionMode
    },
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
    renderRelation(part) {
      const previousMode = projectionMode

      projectionMode = "relation"
      try {
        part.render(context)
      } finally {
        projectionMode = previousMode
      }
    },
  }

  query.render(context)

  return Object.freeze({
    text,
    parameters: Object.freeze(parameters.slice()),
  })
}

function isDialect(value: RenderOptions | Dialect): value is Dialect {
  return "placeholder" in value && "quoteIdentifier" in value
}
