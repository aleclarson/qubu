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
import { resolveCastTarget, type CastTarget } from '../core/dialect.ts'
import type {
  ColumnDefinition,
  ColumnOutput,
  ColumnSqlType,
} from '../schema/column.ts'

type CastDefinition = ColumnDefinition<
  any,
  false,
  any,
  any,
  false,
  false,
  AnySqlType,
  any
> & {
  readonly castTarget: CastTarget
}

/**
 * Cast to a built-in or custom column definition while deriving both result
 * types from that definition. Operand nullability and source facts survive.
 */
export function cast<
  TDefinition extends CastDefinition,
  TExpression extends AnyExpression,
>(
  expression: TExpression,
  definition: TDefinition
): ResultExpression<
  ColumnOutput<TDefinition>,
  TExpression,
  'operator',
  NullabilityOf<TExpression>,
  ColumnSqlType<TDefinition>
>

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
>
export function cast(
  expression: AnyExpression,
  target: string | CastDefinition
): ResultExpression<any, AnyExpression, 'operator', any, AnySqlType> {
  return makeExpression<
    | ResultMeta<any, NullabilityOf<AnyExpression>, AnySqlType>
    | ExpressionMeta<DependenciesOf<AnyExpression>>
    | InheritedMetadata<AnyExpression>,
    'operator'
  >('operator', context => {
    context.append('CAST(')
    context.render(expression)
    context.append(' AS ')
    context.append(
      typeof target === 'string'
        ? target
        : resolveCastTarget(context.dialect, target.castTarget)
    )
    context.append(')')
  })
}

/** Create a cast whose JS output and SQL result domain are declared up front. */
export function typedCast<T, TSqlType extends AnySqlType>() {
  return <TExpression extends AnyExpression, const TType extends string>(
    expression: TExpression,
    typeName: TType
  ) => cast<T, TSqlType, TExpression, TType>(expression, typeName)
}
