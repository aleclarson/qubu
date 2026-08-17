import { fragment, type Fragment } from '../core/fragment.ts'
import { identifier } from '../core/primitives/identifier.ts'
import { makeExpression, type Expression } from './types.ts'

export interface ColumnReference<
  TOutput = unknown,
  TName extends string = string,
  TSource = unknown,
> extends Expression<TOutput, TSource, never, 'column'> {
  readonly columnName: TName
}

export function createColumnReference<TOutput, TName extends string, TSource>(
  name: TName,
  sourceReference: Fragment
): ColumnReference<TOutput, TName, TSource> {
  const expression = makeExpression<TOutput, TSource, never, 'column'>(
    'column',
    context => {
      context.render(sourceReference)
      context.append('.')
      context.render(identifier(name))
    }
  )

  return Object.freeze({
    ...expression,
    columnName: name,
  }) as ColumnReference<TOutput, TName, TSource>
}

export function isColumnReference(value: unknown): value is ColumnReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    'expressionKind' in value &&
    value.expressionKind === 'column'
  )
}

/** Turn an expression into a fragment that renders it without changing it. */
export function expressionFragment(expression: Expression): Fragment {
  return fragment(context => context.render(expression))
}
