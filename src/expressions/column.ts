import {
  type DependenciesOf,
  type ExpressionMeta,
  fragment,
  type MetadataOf,
  type Fragment,
  type RequiresSourceMeta,
  type ResultMeta,
} from '../core/fragment.ts'
import { identifier } from '../core/primitives/identifier.ts'
import { makeExpression, type Expression } from './types.ts'

export interface ColumnReference<
  TName extends string = string,
  TMetadata = never,
> extends Expression<TMetadata, 'column'> {
  readonly columnName: TName
}

export type ColumnDependency<TSource, TName extends string> = {
  readonly kind: 'column'
  readonly source: TSource
  readonly name: TName
}

export type ColumnGroupingDependencies<T> =
  T extends ColumnReference<any, any> ? DependenciesOf<T> : never

export function createColumnReference<TOutput, TName extends string, TSource>(
  name: TName,
  sourceReference: Fragment<never>
): ColumnReference<
  TName,
  | ResultMeta<TOutput, TSource>
  | RequiresSourceMeta<TSource>
  | ExpressionMeta<ColumnDependency<TSource, TName>>
> {
  const expression = makeExpression<
    | ResultMeta<TOutput, TSource>
    | RequiresSourceMeta<TSource>
    | ExpressionMeta<ColumnDependency<TSource, TName>>,
    'column'
  >('column', context => {
    context.render(sourceReference)
    context.append('.')
    context.render(identifier(name))
  })

  return Object.freeze({
    ...expression,
    columnName: name,
  }) as ColumnReference<
    TName,
    | ResultMeta<TOutput, TSource>
    | RequiresSourceMeta<TSource>
    | ExpressionMeta<ColumnDependency<TSource, TName>>
  >
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
export function expressionFragment<TExpression extends Expression>(
  expression: TExpression
): Fragment<MetadataOf<TExpression>> {
  return fragment<MetadataOf<TExpression>>(context =>
    context.render(expression)
  )
}
