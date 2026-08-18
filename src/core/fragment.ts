import type { Dialect } from './dialect.ts'

declare const fragmentMetadata: unique symbol

export type ResultMeta<TOutput, TNullableFrom = never> = {
  readonly kind: 'result'
  readonly output: TOutput
  readonly nullableFrom: TNullableFrom
}

export type RequiresSourceMeta<TSource> = {
  readonly kind: 'requires-source'
  readonly source: TSource
}

export type NullableSourceMeta<TSource> = {
  readonly kind: 'nullable-source'
  readonly source: TSource
}

export type FragmentMeta =
  | ResultMeta<unknown, unknown>
  | RequiresSourceMeta<unknown>
  | NullableSourceMeta<unknown>

export interface RenderContext {
  readonly dialect: Dialect
  append(text: string): void
  parameter(value: unknown): void
  render(part: Fragment<any>): void
}

export type RenderFunction = (context: RenderContext) => void

/**
 * The smallest composable unit in qubu. Runtime rendering is deliberately
 * just a function; the metadata type carries semantic information for
 * TypeScript consumers without imposing an AST on extensions.
 */
export interface Fragment<TMetadata = any> {
  readonly [fragmentMetadata]?: TMetadata
  readonly render: RenderFunction
}

export type AnyFragment = Fragment<any>

export type MetadataOf<T> =
  T extends Fragment<infer TMetadata> ? TMetadata : never

type WithoutResult<TMetadata> = TMetadata extends {
  readonly kind: 'result'
}
  ? never
  : TMetadata

type ResultMetadata<TMetadata> = TMetadata extends {
  readonly kind: 'result'
}
  ? TMetadata
  : never

type ResultOutput<TMetadata> = TMetadata extends {
  readonly output: infer TOutput
}
  ? TOutput
  : never

type ResultNullableFrom<TMetadata> = TMetadata extends {
  readonly nullableFrom: infer TSource
}
  ? TSource
  : never

type RequiredSource<TMetadata> = TMetadata extends {
  readonly kind: 'requires-source'
  readonly source: infer TSource
}
  ? TSource
  : never

type NullableSource<TMetadata> = TMetadata extends {
  readonly kind: 'nullable-source'
  readonly source: infer TSource
}
  ? TSource
  : never

export type InheritedMetadataOf<TMetadata> = WithoutResult<TMetadata>
export type InheritedMetadata<T> = InheritedMetadataOf<MetadataOf<T>>

export type OutputOf<T> = ResultOutput<ResultMetadata<MetadataOf<T>>>

export type RequiresOf<T> = RequiredSource<MetadataOf<T>>

export type NullabilityOf<T> = ResultNullableFrom<ResultMetadata<MetadataOf<T>>>

export type NullableSourcesOf<T> = NullableSource<MetadataOf<T>>

export function fragment<TMetadata = never>(
  render: RenderFunction
): Fragment<TMetadata> {
  return Object.freeze({ render })
}

export function sequence<const TParts extends readonly AnyFragment[]>(
  parts: TParts,
  separator = ' '
): Fragment<InheritedMetadata<TParts[number]>> {
  return fragment<InheritedMetadata<TParts[number]>>(context => {
    let first = true
    for (const part of parts) {
      if (!first) context.append(separator)
      context.render(part)
      first = false
    }
  })
}

export function parenthesize<TPart extends AnyFragment>(
  part: TPart
): Fragment<InheritedMetadata<TPart>> {
  return fragment<InheritedMetadata<TPart>>(context => {
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
