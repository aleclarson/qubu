import type { Dialect, DialectCapability } from "./dialect.ts"
import type { AnySqlType, SqlTypeName, SqlUnknown } from "./sql-types.ts"

declare const fragmentMetadata: unique symbol

/** Result value metadata, including nullability provenance and its SQL domain. */
export type ResultMeta<TOutput, TNullableFrom = never, TSqlType extends AnySqlType = SqlUnknown> = {
  readonly kind: "result"
  readonly output: TOutput
  readonly nullableFrom: TNullableFrom
  readonly sqlType: TSqlType
}

export type RequiresSourceMeta<TSource> = {
  readonly kind: "requires-source"
  readonly source: TSource
}

/** A source that must be provided by the enclosing query scope. */
export type RequiresOuterSourceMeta<TSource> = {
  readonly kind: "requires-outer-source"
  readonly source: TSource
}

/** A correlated query clause that provisions sources from its enclosing scope. */
export type ProvidesOuterSourceMeta<TSource> = {
  readonly kind: "provides-outer-source"
  readonly source: TSource
}

export type NullableSourceMeta<TSource> = {
  readonly kind: "nullable-source"
  readonly source: TSource
}

/** A fragment that introduces a typed relational source to FROM/JOIN. */
export type ProvidesSourceMeta<TSource, TRow = unknown> = {
  readonly kind: "provides-source"
  readonly source: TSource
  readonly row: TRow
}

/** Dependencies read by an expression at the current query level. */
export type ExpressionMeta<TDependencies = unknown> = {
  readonly kind: "expression"
  readonly dependencies: TDependencies
}

/** Dependencies consumed inside an aggregate expression. */
export type AggregateMeta<TDependencies = unknown> = {
  readonly kind: "aggregate"
  readonly dependencies: TDependencies
}

/** Marks an expression that contains a window function. */
export type WindowMeta = { readonly kind: "window" }

/** Marks an expression that contains a scalar or predicate subquery. */
export type SubqueryMeta = { readonly kind: "subquery" }

/** Grouping keys and column dependencies made available by a GROUP BY clause. */
export type GroupingMeta<TKeys = unknown, TDependencies = unknown> = {
  readonly kind: "grouping"
  readonly keys: TKeys
  readonly dependencies: TDependencies
}

export type QueryCardinality = "many" | "zero-or-one" | "exactly-one"

export type CardinalityMeta<TCardinality extends QueryCardinality = QueryCardinality> = {
  readonly kind: "cardinality"
  readonly cardinality: TCardinality
}

/** A fragment whose syntax must be rendered by a dialect with this capability. */
export type RequiresCapabilityMeta<TCapability extends string = DialectCapability> = {
  readonly kind: "requires-capability"
  readonly capability: TCapability
}

export type FragmentMeta =
  | ResultMeta<unknown, unknown, AnySqlType>
  | RequiresSourceMeta<unknown>
  | RequiresOuterSourceMeta<unknown>
  | ProvidesOuterSourceMeta<unknown>
  | NullableSourceMeta<unknown>
  | ProvidesSourceMeta<unknown, unknown>
  | ExpressionMeta
  | AggregateMeta
  | WindowMeta
  | SubqueryMeta
  | GroupingMeta
  | CardinalityMeta
  | RequiresCapabilityMeta

export interface RenderContext {
  readonly dialect: Dialect
  /** Whether selected fields name an application result or a SQL relation. */
  readonly projectionMode: "result" | "relation"
  append(text: string): void
  /** Add one ordered parameter, optionally declaring its runtime SQL domain. */
  parameter(value: unknown, sqlType?: SqlTypeName): void
  render(part: Fragment<any>): void
  /** Render an embedded query with SQL-facing projection names. */
  renderRelation(part: Fragment<any>): void
  /**
   * Optional schema-rendering hook used to emit a bare physical column name. Ordinary query
   * rendering leaves this undefined and retains qualification.
   */
  readonly renderColumnReference?: (columnName: string) => void
}

export type RenderFunction = (context: RenderContext) => void

/**
 * The smallest composable unit in qubu. Runtime rendering is deliberately just a function; the
 * metadata type carries semantic information for TypeScript consumers without imposing an AST on
 * extensions.
 */
export interface Fragment<TMetadata = any> {
  readonly [fragmentMetadata]?: TMetadata
  readonly render: RenderFunction
}

export type AnyFragment = Fragment<any>

export type MetadataOf<T> = T extends Fragment<infer TMetadata> ? TMetadata : never

type WithoutResult<TMetadata> = TMetadata extends {
  readonly kind: "result" | "cardinality"
}
  ? never
  : TMetadata

type ResultMetadata<TMetadata> = TMetadata extends {
  readonly kind: "result"
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

type ResultSqlType<TMetadata> = TMetadata extends {
  readonly sqlType: infer TSqlType extends AnySqlType
}
  ? TSqlType
  : SqlUnknown

type RequiredSource<TMetadata> = TMetadata extends {
  readonly kind: "requires-source"
  readonly source: infer TSource
}
  ? TSource
  : never

type RequiredOuterSource<TMetadata> = TMetadata extends {
  readonly kind: "requires-outer-source"
  readonly source: infer TSource
}
  ? TSource
  : never

type ProvidedOuterSource<TMetadata> = TMetadata extends {
  readonly kind: "provides-outer-source"
  readonly source: infer TSource
}
  ? TSource
  : never

type NullableSource<TMetadata> = TMetadata extends {
  readonly kind: "nullable-source"
  readonly source: infer TSource
}
  ? TSource
  : never

type ExpressionDependencies<TMetadata> = TMetadata extends {
  readonly kind: "expression"
  readonly dependencies: infer TDependencies
}
  ? TDependencies
  : never

type AggregateDependencies<TMetadata> = TMetadata extends {
  readonly kind: "aggregate"
  readonly dependencies: infer TDependencies
}
  ? TDependencies
  : never

type GroupingKeys<TMetadata> = TMetadata extends {
  readonly kind: "grouping"
  readonly keys: infer TKeys
}
  ? TKeys
  : never

type GroupingDependencies<TMetadata> = TMetadata extends {
  readonly kind: "grouping"
  readonly dependencies: infer TDependencies
}
  ? TDependencies
  : never

type Cardinality<TMetadata> = TMetadata extends {
  readonly kind: "cardinality"
  readonly cardinality: infer TCardinality
}
  ? TCardinality
  : never

type RequiredCapabilities<TMetadata> = TMetadata extends {
  readonly kind: "requires-capability"
  readonly capability: infer TCapability extends string
}
  ? TCapability
  : never

export type InheritedMetadataOf<TMetadata> = WithoutResult<TMetadata>
export type InheritedMetadata<T> = InheritedMetadataOf<MetadataOf<T>>

export type OutputOf<T> = ResultOutput<ResultMetadata<MetadataOf<T>>>

/** The SQL semantic domain produced by a result-bearing fragment. */
export type SqlTypeOf<T> = ResultSqlType<ResultMetadata<MetadataOf<T>>>

export type RequiresOf<T> = RequiredSource<MetadataOf<T>>

export type RequiresOuterOf<T> = RequiredOuterSource<MetadataOf<T>>

export type ProvidesOuterOf<T> = ProvidedOuterSource<MetadataOf<T>>

export type RequiresOuterMetadataOf<T> = Extract<
  MetadataOf<T>,
  { readonly kind: "requires-outer-source" }
>

export type NullabilityOf<T> = ResultNullableFrom<ResultMetadata<MetadataOf<T>>>

export type NullableSourcesOf<T> = NullableSource<MetadataOf<T>>

export type DependenciesOf<T> = ExpressionDependencies<MetadataOf<T>>

export type AggregateDependenciesOf<T> = AggregateDependencies<MetadataOf<T>>

/** Dependencies still visible after aggregate arguments have been consumed. */
export type VisibleDependenciesOf<T> = Exclude<DependenciesOf<T>, AggregateDependenciesOf<T>>

export type GroupingKeysOf<T> = GroupingKeys<MetadataOf<T>>

export type GroupingDependenciesOf<T> = GroupingDependencies<MetadataOf<T>>

export type HasAggregate<T> = [Extract<MetadataOf<T>, { readonly kind: "aggregate" }>] extends [
  never,
]
  ? false
  : true

export type HasWindow<T> = [Extract<MetadataOf<T>, { readonly kind: "window" }>] extends [never]
  ? false
  : true

export type HasSubquery<T> = [Extract<MetadataOf<T>, { readonly kind: "subquery" }>] extends [never]
  ? false
  : true

export type CardinalityOf<T> = Cardinality<MetadataOf<T>>

export type CapabilitiesOf<T> = RequiredCapabilities<MetadataOf<T>>

export type CapabilityMetadataOf<T> = [CapabilitiesOf<T>] extends [never]
  ? never
  : RequiresCapabilityMeta<CapabilitiesOf<T>>

export function fragment<TMetadata = never>(render: RenderFunction): Fragment<TMetadata> {
  return Object.freeze({ render })
}

export function sequence<const TParts extends readonly AnyFragment[]>(
  parts: TParts,
  separator = " ",
): Fragment<InheritedMetadata<TParts[number]>> {
  return fragment<InheritedMetadata<TParts[number]>>((context) => {
    let first = true

    for (const part of parts) {
      if (!first) {
        context.append(separator)
      }

      context.render(part)
      first = false
    }
  })
}

export function parenthesize<TPart extends AnyFragment>(
  part: TPart,
): Fragment<InheritedMetadata<TPart>> {
  return fragment<InheritedMetadata<TPart>>((context) => {
    context.append("(")
    context.render(part)
    context.append(")")
  })
}

export function isFragment(value: unknown): value is AnyFragment {
  return (
    typeof value === "object" &&
    value !== null &&
    "render" in value &&
    typeof value.render === "function"
  )
}
