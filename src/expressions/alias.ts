import { identifier } from '../core/primitives/identifier.ts'
import { makeExpression, type Expression } from './types.ts'

export interface AliasedExpression<
  TOutput = unknown,
  TAlias extends string = string,
  TRequires = never,
  TParameters = never,
> extends Expression<TOutput, TRequires, TParameters, 'alias'> {
  readonly aliasName: TAlias
  readonly expression: Expression<TOutput, TRequires, TParameters, any>
}

export function aliasExpression<
  TOutput,
  const TAlias extends string,
  TRequires,
  TParameters,
>(
  expression: Expression<TOutput, TRequires, TParameters, any>,
  name: TAlias
): AliasedExpression<TOutput, TAlias, TRequires, TParameters> {
  const aliased = makeExpression<TOutput, TRequires, TParameters, 'alias'>(
    'alias',
    context => {
      context.render(expression)
      context.append(' AS ')
      context.render(identifier(name))
    }
  )

  return Object.freeze({
    ...aliased,
    aliasName: name,
    expression,
  }) as AliasedExpression<TOutput, TAlias, TRequires, TParameters>
}

export const asExpression = aliasExpression
