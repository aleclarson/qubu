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
  type Fragment,
  type RenderContext,
} from '../core/fragment.ts'
import type { AnySqlType } from '../core/sql-types.ts'
import {
  assertDialectCapability,
  type DialectCapability,
} from '../core/dialect.ts'

export type ExpressionKind =
  | 'value'
  | 'column'
  | 'function'
  | 'operator'
  | 'subquery'
  | 'unsafe'

export interface Expression<
  TMetadata = any,
  TKind extends ExpressionKind = ExpressionKind,
> extends Fragment<TMetadata> {
  readonly expressionKind: TKind
}

export type AnyExpression = Expression<any, any>
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
): Expression<
  | import('../core/fragment.ts').MetadataOf<TExpression>
  | import('../core/fragment.ts').RequiresCapabilityMeta<TCapability>,
  TExpression['expressionKind']
> {
  type TMetadata =
    | import('../core/fragment.ts').MetadataOf<TExpression>
    | import('../core/fragment.ts').RequiresCapabilityMeta<TCapability>

  return makeExpression<TMetadata, TExpression['expressionKind']>(
    expression.expressionKind,
    context => {
      assertDialectCapability(context.dialect, capability)
      context.render(expression)
    }
  )
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
  | RequiresCapabilityMeta,
  TKind
>

/** Build an expression result while inheriting non-result metadata from children. */
export type ResultExpression<
  TOutput,
  TChildren = never,
  TKind extends ExpressionKind = ExpressionKind,
  TNullableFrom = NullabilityOf<TChildren>,
  TSqlType extends AnySqlType = import('../core/sql-types.ts').SqlUnknown,
> = Expression<
  | ResultMeta<TOutput, TNullableFrom, TSqlType>
  | ExpressionMeta<DependenciesOf<TChildren>>
  | InheritedMetadata<TChildren>,
  TKind
>

/** Build an aggregate result while recording which dependencies it consumes. */
export type AggregateResultExpression<
  TOutput,
  TChildren = never,
  TKind extends ExpressionKind = ExpressionKind,
  TNullableFrom = NullabilityOf<TChildren>,
  TSqlType extends AnySqlType = import('../core/sql-types.ts').SqlUnknown,
> = Expression<
  | ResultMeta<TOutput, TNullableFrom, TSqlType>
  | ExpressionMeta<DependenciesOf<TChildren>>
  | AggregateMeta<DependenciesOf<TChildren>>
  | InheritedMetadata<TChildren>,
  TKind
>

/** Preserve the SQL domain of a result-producing child expression. */
export type ResultExpressionLike<
  TExpression extends AnyExpression,
  TOutput = OutputOf<TExpression>,
  TKind extends ExpressionKind = ExpressionKind,
  TNullableFrom = NullabilityOf<TExpression>,
> = ResultExpression<
  TOutput,
  TExpression,
  TKind,
  TNullableFrom,
  SqlTypeOf<TExpression>
>

export function makeExpression<
  TMetadata = never,
  TKind extends ExpressionKind = ExpressionKind,
>(
  expressionKind: TKind,
  render: (context: RenderContext) => void
): Expression<TMetadata, TKind> {
  return Object.freeze({
    expressionKind,
    ...fragment<TMetadata>(render),
  }) as Expression<TMetadata, TKind>
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
