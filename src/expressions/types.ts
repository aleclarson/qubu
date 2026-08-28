import {
  type AggregateMeta,
  type DependenciesOf,
  type ExpressionMeta,
  fragment,
  type InheritedMetadata,
  type NullabilityOf,
  type NullableSourceMeta,
  type OutputOf,
  type RequiresOf,
  type RequiresCapabilityMeta,
  type RequiresSourceMeta,
  type ResultMeta,
  type SqlTypeOf,
  type SubqueryMeta,
  type WindowMeta,
  type Fragment,
  type RenderContext,
} from '../core/fragment.ts'
import type { AnySqlType } from '../core/sql-types.ts'
import {
  assertDialectCapability,
  type DialectCapability,
} from '../core/dialect.ts'
import {
  attachResultValue,
  resultValueOf,
  type ResultValueCarrier,
  type ResultValueMetadata,
} from '../result.ts'

export type ExpressionKind =
  | 'value'
  | 'column'
  | 'function'
  | 'operator'
  | 'sql'
  | 'subquery'
  | 'unsafe'

/** Runtime/type-level proof that an expression is safe to use in schema SQL. */
export const schemaExpressionBrand: unique symbol = Symbol(
  'qubu.schema-expression'
)

export interface SchemaExpressionBrand {
  readonly [schemaExpressionBrand]: true
}

export interface Expression<
  TMetadata = any,
  TKind extends ExpressionKind = ExpressionKind,
> extends Fragment<TMetadata>,
    ResultValueCarrier {
  readonly expressionKind: TKind
  /** Internal runtime marker for query constructs rejected by schema SQL. */
  readonly expressionCategory?: 'aggregate' | 'window' | 'subquery'
}

/**
 * An expression whose renderer is deterministic and may be used by schema
 * metadata. Query extensions remain ordinary {@link Expression} values until
 * they explicitly opt into this contract.
 */
export type SchemaExpression<
  TMetadata = any,
  TKind extends ExpressionKind = ExpressionKind,
> = Expression<TMetadata, TKind> & SchemaExpressionBrand

export type AnyExpression = Expression<any, any>
export type AnySchemaExpression = SchemaExpression<any, any>
export type ExpressionOutput<T> = OutputOf<T>
export type ExpressionRequires<T> = RequiresOf<T>
export type ExpressionNullability<T> = NullabilityOf<T>
/** Extract the SQL semantic domain produced by an expression. */
export type ExpressionSqlType<T> = import('../core/fragment.ts').SqlTypeOf<T>

/** Add a concrete dialect requirement without dropping expression metadata. */
export function withDialectCapability<
  const TCapability extends DialectCapability,
  TExpression extends AnyExpression,
>(
  expression: TExpression,
  capability: TCapability
): TExpression extends SchemaExpression<any, any>
  ? SchemaExpression<
      | import('../core/fragment.ts').MetadataOf<TExpression>
      | import('../core/fragment.ts').RequiresCapabilityMeta<TCapability>,
      TExpression['expressionKind']
    >
  : Expression<
      | import('../core/fragment.ts').MetadataOf<TExpression>
      | import('../core/fragment.ts').RequiresCapabilityMeta<TCapability>,
      TExpression['expressionKind']
    > {
  type TMetadata =
    | import('../core/fragment.ts').MetadataOf<TExpression>
    | import('../core/fragment.ts').RequiresCapabilityMeta<TCapability>

  const wrapped = makeExpression<TMetadata, TExpression['expressionKind']>(
    expression.expressionKind,
    context => {
      assertDialectCapability(context.dialect, capability)
      context.render(expression)
    },
    expression.expressionCategory,
    resultValueOf(expression)
  )
  return (isSchemaExpression(expression)
    ? markSchemaExpression(wrapped)
    : wrapped) as unknown as TExpression extends SchemaExpression<any, any>
    ? SchemaExpression<TMetadata, TExpression['expressionKind']>
    : Expression<TMetadata, TExpression['expressionKind']>
}

/** An expression whose result is known to be assignable to `TOutput`. */
export type ExpressionWithOutput<
  TOutput,
  TKind extends ExpressionKind = ExpressionKind,
> = Expression<
  | ResultMeta<TOutput, unknown, AnySqlType>
  | RequiresSourceMeta<unknown>
  | NullableSourceMeta<unknown>
  | ExpressionMeta<unknown>
  | AggregateMeta<unknown>
  | RequiresCapabilityMeta
  | WindowMeta
  | SubqueryMeta,
  TKind
>

/** Sparse type-level configuration for a result-producing expression. */
export interface ResultExpressionConfig {
  readonly output?: unknown
  readonly children?: unknown
  readonly kind?: ExpressionKind
  readonly nullableFrom?: unknown
  readonly sqlType?: AnySqlType
}

type ResultConfigValue<
  TConfig,
  TKey extends PropertyKey,
  TFallback,
> = TKey extends keyof TConfig ? TConfig[TKey] : TFallback

type ResultConfigOutput<TConfig> = ResultConfigValue<TConfig, 'output', unknown>
type ResultConfigChildren<TConfig> = ResultConfigValue<
  TConfig,
  'children',
  never
>
type ResultConfigKind<TConfig> = Extract<
  ResultConfigValue<TConfig, 'kind', ExpressionKind>,
  ExpressionKind
>
type ResultConfigNullableFrom<TConfig> = ResultConfigValue<
  TConfig,
  'nullableFrom',
  NullabilityOf<ResultConfigChildren<TConfig>>
>
type ResultConfigSqlType<TConfig> = Extract<
  ResultConfigValue<
    TConfig,
    'sqlType',
    import('../core/sql-types.ts').SqlUnknown
  >,
  AnySqlType
>

/** Build an expression result while inheriting non-result metadata from children. */
export type ResultExpression<TConfig extends ResultExpressionConfig = {}> =
  SchemaExpression<
    | ResultMeta<
        ResultConfigOutput<TConfig>,
        ResultConfigNullableFrom<TConfig>,
        ResultConfigSqlType<TConfig>
      >
    | ExpressionMeta<DependenciesOf<ResultConfigChildren<TConfig>>>
    | InheritedMetadata<ResultConfigChildren<TConfig>>,
    ResultConfigKind<TConfig>
  >

/** Build an aggregate result while recording which dependencies it consumes. */
export type AggregateResultExpression<
  TConfig extends ResultExpressionConfig = {},
> = Expression<
  | ResultMeta<
      ResultConfigOutput<TConfig>,
      ResultConfigNullableFrom<TConfig>,
      ResultConfigSqlType<TConfig>
    >
  | ExpressionMeta<DependenciesOf<ResultConfigChildren<TConfig>>>
  | AggregateMeta<DependenciesOf<ResultConfigChildren<TConfig>>>
  | InheritedMetadata<ResultConfigChildren<TConfig>>,
  ResultConfigKind<TConfig>
>

/** A result expression that contains a query boundary. */
export type SubqueryResultExpression<
  TConfig extends Omit<ResultExpressionConfig, 'kind'> = {},
> = Expression<
  | ResultMeta<
      ResultConfigOutput<TConfig>,
      ResultConfigNullableFrom<TConfig>,
      ResultConfigSqlType<TConfig>
    >
  | ExpressionMeta<DependenciesOf<ResultConfigChildren<TConfig>>>
  | InheritedMetadata<ResultConfigChildren<TConfig>>
  | SubqueryMeta,
  'subquery'
>

/** Preserve the SQL domain of a result-producing child expression. */
export type ResultExpressionLike<
  TConfig extends ResultExpressionConfig & {
    readonly expression: AnyExpression
  },
> = ResultExpression<{
  readonly output: ResultConfigValue<
    TConfig,
    'output',
    OutputOf<TConfig['expression']>
  >
  readonly children: TConfig['expression']
  readonly kind: ResultConfigKind<TConfig>
  readonly nullableFrom: ResultConfigValue<
    TConfig,
    'nullableFrom',
    NullabilityOf<TConfig['expression']>
  >
  readonly sqlType: SqlTypeOf<TConfig['expression']>
}>

export function makeExpression<
  TMetadata = never,
  TKind extends ExpressionKind = ExpressionKind,
>(
  expressionKind: TKind,
  render: (context: RenderContext) => void,
  expressionCategory?: 'aggregate' | 'window' | 'subquery',
  result?: ResultValueMetadata
): Expression<TMetadata, TKind> {
  return attachResultValue(
    Object.freeze({
      expressionKind,
      ...(expressionCategory ? { expressionCategory } : {}),
      ...fragment<TMetadata>(render),
    }) as Expression<TMetadata, TKind>,
    result
  ) as Expression<TMetadata, TKind>
}

/** Mark a query-only expression category without changing its SQL renderer. */
export function markExpressionCategory<TMetadata, TKind extends ExpressionKind>(
  expression: Expression<TMetadata, TKind>,
  category: 'aggregate' | 'window' | 'subquery'
): Expression<TMetadata, TKind> {
  return Object.freeze({ ...expression, expressionCategory: category })
}

/**
 * Mark a built-in or explicitly audited renderer as schema-deterministic.
 * Prefer {@link defineSchemaExpression} for application extensions because it
 * supplies a restricted schema rendering context.
 */
export function makeSchemaExpression<
  TMetadata = never,
  TKind extends ExpressionKind = ExpressionKind,
>(
  expressionKind: TKind,
  render: (context: RenderContext) => void,
  result?: ResultValueMetadata
): SchemaExpression<TMetadata, TKind> {
  const expression = makeExpression<TMetadata, TKind>(
    expressionKind,
    render,
    undefined,
    result
  )
  return Object.freeze({
    ...expression,
    [schemaExpressionBrand]: true as const,
  }) as SchemaExpression<TMetadata, TKind>
}

/** Add the schema-determinism brand to an explicitly audited expression. */
export function markSchemaExpression<TMetadata, TKind extends ExpressionKind>(
  expression: Expression<TMetadata, TKind>
): SchemaExpression<TMetadata, TKind> {
  if (isSchemaExpression(expression)) return expression
  return Object.freeze({
    ...expression,
    [schemaExpressionBrand]: true as const,
  }) as SchemaExpression<TMetadata, TKind>
}

/** Test the runtime brand used by schema rendering and validation. */
export function isSchemaExpression(
  value: unknown
): value is AnySchemaExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    schemaExpressionBrand in value &&
    (value as Record<PropertyKey, unknown>)[schemaExpressionBrand] === true
  )
}

export function isExpression(value: unknown): value is AnyExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    'expressionKind' in value &&
    'render' in value &&
    typeof value.render === 'function'
  )
}
