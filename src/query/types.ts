import {
  fragment,
  type CardinalityMeta,
  type Fragment,
  type QueryCardinality,
  type ResultMeta,
  type RenderFunction,
} from "../core/fragment.ts"
import type { ResultShape } from "../result.ts"
import type { SourceSqlTypes, UnknownSourceSqlTypes } from "../schema/source.ts"

export type Row = Record<string, unknown>

export type QueryKind = "select" | "set" | "insert" | "update" | "delete"

/** Sparse type-level configuration carried by a query. */
export interface QueryConfig {
  readonly row?: object
  readonly cardinality?: QueryCardinality
  readonly metadata?: unknown
  readonly sqlTypes?: unknown
}

type QueryConfigValue<TConfig, TKey extends PropertyKey, TFallback> = TKey extends keyof TConfig
  ? TConfig[TKey]
  : TFallback

type QueryConfigRow<TConfig> = Extract<QueryConfigValue<TConfig, "row", Row>, object>
type QueryConfigCardinality<TConfig> = Extract<
  QueryConfigValue<TConfig, "cardinality", QueryCardinality>,
  QueryCardinality
>
type QueryConfigMetadata<TConfig> = QueryConfigValue<TConfig, "metadata", never>
type QueryConfigSqlTypes<TConfig> = QueryConfigValue<
  TConfig,
  "sqlTypes",
  SourceSqlTypes<QueryConfigRow<TConfig>>
>

export interface Query<TConfig extends QueryConfig = {}> extends Fragment<
  | ResultMeta<readonly QueryConfigRow<TConfig>[]>
  | CardinalityMeta<QueryConfigCardinality<TConfig>>
  | QueryConfigMetadata<TConfig>
> {
  /** @internal Type-level configuration retained for inference. */
  readonly __queryConfig?: TConfig
  readonly queryKind: QueryKind
  /** @internal Runtime row-bound proof retained by built-in query constructors. */
  readonly cardinality?: QueryCardinality
  readonly row: QueryConfigRow<TConfig>
  /** Runtime metadata used to decode named result fields. */
  readonly resultShape: ResultShape
  /** @internal Render a SELECT with an ordering ordinal for nested JSON aggregation. */
  readonly renderJsonRows?: (
    context: import("../core/fragment.ts").RenderContext,
    ordinal: string,
  ) => void
  /** Type-only SQL domains of the named query projection. */
  readonly sqlTypes?: QueryConfigSqlTypes<TConfig>
}

export type AnyQuery = Query<any>
export type QueryWithRow<TRow extends object> = Query<{
  readonly row: TRow
  readonly cardinality: any
  readonly metadata: any
  readonly sqlTypes: any
}>
export type QueryRow<T> = T extends { readonly row: infer TRow extends object } ? TRow : never
/** Extract the field-to-SQL-domain map retained by a named query projection. */
export type QuerySqlTypeMap<T> = T extends {
  readonly row: infer TRow extends object
  readonly sqlTypes?: infer TSqlTypes
}
  ? TSqlTypes & SourceSqlTypes<TRow>
  : never

export function createQuery<
  TRow extends object,
  TCardinality extends QueryCardinality = "many",
  TMetadata = never,
  TSqlTypes = UnknownSourceSqlTypes<TRow>,
>(
  queryKind: QueryKind,
  row: TRow,
  resultShape: ResultShape,
  render: RenderFunction,
): Query<{
  readonly row: TRow
  readonly cardinality: TCardinality
  readonly metadata: TMetadata
  readonly sqlTypes: TSqlTypes
}> {
  return Object.freeze({
    queryKind,
    row,
    resultShape,
    ...fragment<ResultMeta<readonly TRow[]> | CardinalityMeta<TCardinality> | TMetadata>(render),
  }) as Query<{
    readonly row: TRow
    readonly cardinality: TCardinality
    readonly metadata: TMetadata
    readonly sqlTypes: TSqlTypes
  }>
}
