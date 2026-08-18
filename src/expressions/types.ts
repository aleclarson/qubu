import {
  fragment,
  type InheritedMetadata,
  type NullabilityOf,
  type NullableSourceMeta,
  type OutputOf,
  type RequiresOf,
  type RequiresSourceMeta,
  type ResultMeta,
  type Fragment,
  type RenderContext,
} from '../core/fragment.ts'

export type ExpressionKind =
  | 'value'
  | 'column'
  | 'alias'
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

/** An expression whose result is known to be assignable to `TOutput`. */
export type ExpressionWithOutput<
  TOutput,
  TKind extends ExpressionKind = ExpressionKind,
> = Expression<
  | ResultMeta<TOutput, unknown>
  | RequiresSourceMeta<unknown>
  | NullableSourceMeta<unknown>,
  TKind
>

/** Build an expression result while inheriting non-result metadata from children. */
export type ResultExpression<
  TOutput,
  TChildren = never,
  TKind extends ExpressionKind = ExpressionKind,
  TNullableFrom = NullabilityOf<TChildren>,
> = Expression<
  ResultMeta<TOutput, TNullableFrom> | InheritedMetadata<TChildren>,
  TKind
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
