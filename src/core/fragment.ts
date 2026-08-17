import type { Dialect } from './dialect.ts'

declare const fragmentMetadata: unique symbol

export interface RenderContext {
  readonly dialect: Dialect
  append(text: string): void
  parameter(value: unknown): void
  render(part: Fragment<any, any, any>): void
}

export type RenderFunction = (context: RenderContext) => void

/**
 * The smallest composable unit in qubu. Runtime rendering is deliberately
 * just a function; the generic parameters carry semantic information for
 * TypeScript consumers without imposing an AST on extensions.
 */
export interface Fragment<
  TOutput = unknown,
  TRequires = any,
  TParameters = any,
> {
  readonly [fragmentMetadata]?: {
    readonly output: TOutput
    readonly requires: TRequires
    readonly parameters: TParameters
  }
  readonly render: RenderFunction
}

export type AnyFragment = Fragment<any, any, any>

export type OutputOf<T> =
  T extends Fragment<infer TOutput, any, any> ? TOutput : never

export type RequiresOf<T> =
  T extends Fragment<any, infer TRequires, any> ? TRequires : never

export type ParametersOf<T> =
  T extends Fragment<any, any, infer TParameters> ? TParameters : never

export function fragment<
  TOutput = unknown,
  TRequires = never,
  TParameters = never,
>(render: RenderFunction): Fragment<TOutput, TRequires, TParameters> {
  return Object.freeze({ render })
}

export function sequence(
  parts: readonly AnyFragment[],
  separator = ' '
): AnyFragment {
  return fragment(context => {
    let first = true
    for (const part of parts) {
      if (!first) context.append(separator)
      context.render(part)
      first = false
    }
  })
}

export function parenthesize(part: AnyFragment): AnyFragment {
  return fragment(context => {
    context.append('(')
    context.render(part)
    context.append(')')
  })
}

export function isFragment(value: unknown): value is AnyFragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    'render' in value &&
    typeof value.render === 'function'
  )
}
