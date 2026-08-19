import {
  makeExpression,
  type AnyExpression,
  type ResultExpression,
} from './types.ts'
import {
  type DependenciesOf,
  type ExpressionMeta,
  type InheritedMetadata,
  type NullabilityOf,
  type ResultMeta,
} from '../core/fragment.ts'
import type { AnySqlType, SqlUnknown } from '../core/sql-types.ts'

/** Cast using a type name supplied by the caller or an adapter. */
export function cast<
  T,
  TSqlType extends AnySqlType = SqlUnknown,
  TExpression extends AnyExpression = AnyExpression,
  const TType extends string = string,
>(
  expression: TExpression,
  typeName: TType
): ResultExpression<
  T,
  TExpression,
  'operator',
  NullabilityOf<TExpression>,
  TSqlType
> {
  return makeExpression<
    | ResultMeta<T, NullabilityOf<TExpression>, TSqlType>
    | ExpressionMeta<DependenciesOf<TExpression>>
    | InheritedMetadata<TExpression>,
    'operator'
  >('operator', context => {
    context.append('CAST(')
    context.render(expression)
    context.append(' AS ')
    context.append(typeName)
    context.append(')')
  }) as ResultExpression<
    T,
    TExpression,
    'operator',
    NullabilityOf<TExpression>,
    TSqlType
  >
}

/** Create a cast whose JS output and SQL result domain are declared up front. */
export function typedCast<T, TSqlType extends AnySqlType>() {
  return <TExpression extends AnyExpression, const TType extends string>(
    expression: TExpression,
    typeName: TType
  ) => cast<T, TSqlType, TExpression, TType>(expression, typeName)
}
