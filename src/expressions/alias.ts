import { identifier } from '../core/primitives/identifier.ts'
import { makeExpression, type AnyExpression, type Expression } from './types.ts'
import {
  type InheritedMetadata,
  type NullabilityOf,
  type ResultMeta,
} from '../core/fragment.ts'

export interface AliasedExpression<
  TAlias extends string = string,
  TMetadata = never,
  TExpression extends AnyExpression = AnyExpression,
> extends Expression<TMetadata, 'alias'> {
  readonly aliasName: TAlias
  readonly expression: TExpression
}

export function aliasExpression<
  const TAlias extends string,
  TExpression extends AnyExpression,
>(
  expression: TExpression,
  name: TAlias
): AliasedExpression<
  TAlias,
  | ResultMeta<
      import('./types.ts').ExpressionOutput<TExpression>,
      NullabilityOf<TExpression>
    >
  | InheritedMetadata<TExpression>,
  TExpression
> {
  type TOutput = import('./types.ts').ExpressionOutput<TExpression>
  type TMetadata =
    | ResultMeta<TOutput, NullabilityOf<TExpression>>
    | InheritedMetadata<TExpression>
  const aliased = makeExpression<TMetadata, 'alias'>('alias', context => {
    context.render(expression)
    context.append(' AS ')
    context.render(identifier(name))
  })

  return Object.freeze({
    ...aliased,
    aliasName: name,
    expression,
  }) as AliasedExpression<TAlias, TMetadata, TExpression>
}

export const asExpression = aliasExpression
