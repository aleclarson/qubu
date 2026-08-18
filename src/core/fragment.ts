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

/** Dependencies read by an expression at the current query level. */
export type ExpressionMeta<TDependencies = unknown> = {
  readonly kind: 'expression'
  readonly dependencies: TDependencies
}

/** Dependencies consumed inside an aggregate expression. */
export type AggregateMeta<TDependencies = unknown> = {
  readonly kind: 'aggregate'
  readonly dependencies: TDependencies
}

/** Grouping keys and column dependencies made available by a GROUP BY clause. */
export type GroupingMeta<TKeys = unknown, TDependencies = unknown> = {
  readonly kind: 'grouping'
  readonly keys: TKeys
  readonly dependencies: TDependencies
}

export type QueryCardinality = 'many' | 'zero-or-one' | 'exactly-one'

export type CardinalityMeta<
  TCardinality extends QueryCardinality = QueryCardinality,
> = {
  readonly kind: 'cardinality'
  readonly cardinality: TCardinality
}

export type FragmentMeta =
  | ResultMeta<unknown, unknown>
  | RequiresSourceMeta<unknown>
  | NullableSourceMeta<unknown>
  | ExpressionMeta
  | AggregateMeta
  | GroupingMeta
  | CardinalityMeta

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
  readonly kind: 'result' | 'cardinality'
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

type ExpressionDependencies<TMetadata> = TMetadata extends {
  readonly kind: 'expression'
  readonly dependencies: infer TDependencies
}
  ? TDependencies
  : never

type AggregateDependencies<TMetadata> = TMetadata extends {
  readonly kind: 'aggregate'
  readonly dependencies: infer TDependencies
}
  ? TDependencies
  : never

type GroupingKeys<TMetadata> = TMetadata extends {
  readonly kind: 'grouping'
  readonly keys: infer TKeys
}
  ? TKeys
  : never

type GroupingDependencies<TMetadata> = TMetadata extends {
  readonly kind: 'grouping'
  readonly dependencies: infer TDependencies
}
  ? TDependencies
  : never

type Cardinality<TMetadata> = TMetadata extends {
  readonly kind: 'cardinality'
  readonly cardinality: infer TCardinality
}
  ? TCardinality
  : never

export type InheritedMetadataOf<TMetadata> = WithoutResult<TMetadata>
export type InheritedMetadata<T> = InheritedMetadataOf<MetadataOf<T>>

export type OutputOf<T> = ResultOutput<ResultMetadata<MetadataOf<T>>>

export type RequiresOf<T> = RequiredSource<MetadataOf<T>>

export type NullabilityOf<T> = ResultNullableFrom<ResultMetadata<MetadataOf<T>>>

export type NullableSourcesOf<T> = NullableSource<MetadataOf<T>>

export type DependenciesOf<T> = ExpressionDependencies<MetadataOf<T>>

export type AggregateDependenciesOf<T> = AggregateDependencies<MetadataOf<T>>

/** Dependencies still visible after aggregate arguments have been consumed. */
export type VisibleDependenciesOf<T> = Exclude<
  DependenciesOf<T>,
  AggregateDependenciesOf<T>
>

export type GroupingKeysOf<T> = GroupingKeys<MetadataOf<T>>

export type GroupingDependenciesOf<T> = GroupingDependencies<MetadataOf<T>>

export type HasAggregate<T> = [
  Extract<MetadataOf<T>, { readonly kind: 'aggregate' }>,
] extends [never]
  ? false
  : true

export type CardinalityOf<T> = Cardinality<MetadataOf<T>>

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
