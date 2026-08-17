import {
  fragment,
  type Fragment,
  type ParametersOf,
  type RequiresOf,
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
  TOutput = unknown,
  TRequires = never,
  TParameters = never,
  TKind extends ExpressionKind = ExpressionKind,
> extends Fragment<TOutput, TRequires, TParameters> {
  readonly expressionKind: TKind
}

export type AnyExpression = Expression<any, any, any, any>
export type ExpressionOutput<T> =
  T extends Expression<infer TOutput, any, any, any> ? TOutput : never
export type ExpressionRequires<T> = RequiresOf<T>
export type ExpressionParameters<T> = ParametersOf<T>

export function makeExpression<
  TOutput,
  TRequires = never,
  TParameters = never,
  TKind extends ExpressionKind = ExpressionKind,
>(
  expressionKind: TKind,
  render: (context: RenderContext) => void
): Expression<TOutput, TRequires, TParameters, TKind> {
  return Object.freeze({
    expressionKind,
    ...fragment<TOutput, TRequires, TParameters>(render),
  }) as Expression<TOutput, TRequires, TParameters, TKind>
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
