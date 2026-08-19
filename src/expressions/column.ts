import {
  type DependenciesOf,
  type ExpressionMeta,
  fragment,
  type MetadataOf,
  type Fragment,
  type RequiresSourceMeta,
  type ResultMeta,
} from '../core/fragment.ts'
import type { AnySqlType, SqlUnknown } from '../core/sql-types.ts'
import { identifier } from '../core/primitives/identifier.ts'
import { makeExpression, type Expression } from './types.ts'

export interface ColumnReference<
  TFieldName extends string = string,
  TMetadata = never,
> extends Expression<TMetadata, 'column'> {
  /** Application-facing key used by typed rows and dependency metadata. */
  readonly fieldName: TFieldName
  /** Physical SQL identifier rendered for this column. */
  readonly columnName: string
}

export type ColumnDependency<TSource, TName extends string> = {
  readonly kind: 'column'
  readonly source: TSource
  readonly name: TName
}

export type ColumnGroupingDependencies<T> =
  T extends ColumnReference<any, any> ? DependenciesOf<T> : never

export function createColumnReference<
  TOutput,
  TFieldName extends string,
  TSource,
  TSqlType extends AnySqlType = SqlUnknown,
>(
  columnName: string,
  sourceReference: Fragment<never>,
  fieldName: TFieldName
): ColumnReference<
  TFieldName,
  | ResultMeta<TOutput, TSource, TSqlType>
  | RequiresSourceMeta<TSource>
  | ExpressionMeta<ColumnDependency<TSource, TFieldName>>
> {
  const expression = makeExpression<
    | ResultMeta<TOutput, TSource, TSqlType>
    | RequiresSourceMeta<TSource>
    | ExpressionMeta<ColumnDependency<TSource, TFieldName>>,
    'column'
  >('column', context => {
    context.render(sourceReference)
    context.append('.')
    context.render(identifier(columnName))
  })

  return Object.freeze({
    ...expression,
    fieldName,
    columnName,
  }) as ColumnReference<
    TFieldName,
    | ResultMeta<TOutput, TSource, TSqlType>
    | RequiresSourceMeta<TSource>
    | ExpressionMeta<ColumnDependency<TSource, TFieldName>>
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
