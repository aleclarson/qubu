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

/** Cast using a type name supplied by the caller or an adapter. */
export function cast<
  T,
  TExpression extends AnyExpression,
  const TType extends string,
>(
  expression: TExpression,
  typeName: TType
): ResultExpression<T, TExpression, 'operator'> {
  return makeExpression<
    | ResultMeta<T, NullabilityOf<TExpression>>
    | ExpressionMeta<DependenciesOf<TExpression>>
    | InheritedMetadata<TExpression>,
    'operator'
  >('operator', context => {
    context.append('CAST(')
    context.render(expression)
    context.append(' AS ')
    context.append(typeName)
    context.append(')')
  }) as ResultExpression<T, TExpression, 'operator'>
}
