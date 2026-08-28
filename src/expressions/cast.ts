import {
  makeSchemaExpression,
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
import {
  columnResultValue,
  type ColumnDefinition,
  type ColumnOutput,
  type ColumnSqlType,
} from '../schema/column.ts'

type CastDefinition = ColumnDefinition<any> & {
  readonly nullable: false
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
): ResultExpression<{
  readonly output: ColumnOutput<TDefinition>
  readonly children: TExpression
  readonly kind: 'operator'
  readonly nullableFrom: NullabilityOf<TExpression>
  readonly sqlType: ColumnSqlType<TDefinition>
}>

/** Cast using a type name supplied by the caller or an adapter. */
export function cast<
  T,
  TSqlType extends AnySqlType = SqlUnknown,
  TExpression extends AnyExpression = AnyExpression,
  const TType extends string = string,
>(
  expression: TExpression,
  typeName: TType
): ResultExpression<{
  readonly output: T
  readonly children: TExpression
  readonly kind: 'operator'
  readonly nullableFrom: NullabilityOf<TExpression>
  readonly sqlType: TSqlType
}>
export function cast(
  expression: AnyExpression,
  target: string | CastDefinition
): ResultExpression<{
  readonly output: any
  readonly children: AnyExpression
  readonly kind: 'operator'
  readonly nullableFrom: any
  readonly sqlType: AnySqlType
}> {
  return makeSchemaExpression<
    | ResultMeta<any, NullabilityOf<AnyExpression>, AnySqlType>
    | ExpressionMeta<DependenciesOf<AnyExpression>>
    | InheritedMetadata<AnyExpression>,
    'operator'
  >(
    'operator',
    context => {
      context.append('CAST(')
      context.render(expression)
      context.append(' AS ')
      context.append(
        typeof target === 'string'
          ? target
          : resolveCastTarget(context.dialect, target.castTarget)
      )
      context.append(')')
    },
    typeof target === 'string' ? undefined : columnResultValue(target)
  )
}

/** Create a cast whose JS output and SQL result domain are declared up front. */
export function typedCast<T, TSqlType extends AnySqlType>() {
  return <TExpression extends AnyExpression, const TType extends string>(
    expression: TExpression,
    typeName: TType
  ) => cast<T, TSqlType, TExpression, TType>(expression, typeName)
}
