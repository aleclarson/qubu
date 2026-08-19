import { routineName } from '../../core/primitives/routine.ts'
import {
  type DependenciesOf,
  type ExpressionMeta,
  type InheritedMetadata,
  type NullabilityOf,
  type RequiresOf,
  type ResultMeta,
} from '../../core/fragment.ts'
import { asValue } from '../value.ts'
import {
  makeExpression,
  makeSchemaExpression,
  type Expression,
  type SchemaExpression,
} from '../types.ts'
import type { AnySqlType, SqlUnknown } from '../../core/sql-types.ts'

export type FunctionArguments<T extends readonly unknown[]> = RequiresOf<
  T[number]
>

export function call<
  TOutput = unknown,
  const TName extends string = string,
  const TArguments extends readonly unknown[] = readonly unknown[],
  TNullableFrom = NullabilityOf<TArguments[number]>,
  TSqlType extends AnySqlType = SqlUnknown,
>(name: TName, ...args: TArguments) {
  const expressions = args.map(argument => asValue(argument as never))
  return makeExpression('function', context => {
    context.render(routineName(name))
    context.append('(')
    expressions.forEach((argument, index) => {
      if (index > 0) context.append(', ')
      context.render(argument)
    })
    context.append(')')
  }) as Expression<
    | ResultMeta<TOutput, TNullableFrom, TSqlType>
    | ExpressionMeta<DependenciesOf<TArguments[number]>>
    | InheritedMetadata<TArguments[number]>,
    'function'
  >
}

/**
 * Internal built-in function constructor for deterministic schema functions.
 * Arbitrary calls stay on {@link call} and require an explicit schema
 * extension contract before they can be used in schema metadata.
 */
export function schemaCall<
  TOutput = unknown,
  const TName extends string = string,
  const TArguments extends readonly unknown[] = readonly unknown[],
  TNullableFrom = NullabilityOf<TArguments[number]>,
  TSqlType extends AnySqlType = SqlUnknown,
>(name: TName, ...args: TArguments) {
  // Validate the routine once at construction time. The schema context only
  // permits branded expressions, so it cannot render the ordinary routine
  // fragment that query calls use internally.
  routineName(name)
  const expressions = args.map(argument => asValue(argument as never))
  return makeSchemaExpression('function', context => {
    context.append(name)
    context.append('(')
    expressions.forEach((argument, index) => {
      if (index > 0) context.append(', ')
      context.render(argument)
    })
    context.append(')')
  }) as SchemaExpression<
    | ResultMeta<TOutput, TNullableFrom, TSqlType>
    | ExpressionMeta<DependenciesOf<TArguments[number]>>
    | InheritedMetadata<TArguments[number]>,
    'function'
  >
}

/** Declare the SQL result domain of a custom function call. */
export function typedCall<TSqlType extends AnySqlType, TOutput = unknown>() {
  return <
    const TName extends string,
    const TArguments extends readonly unknown[],
  >(
    name: TName,
    ...args: TArguments
  ) =>
    call<
      TOutput,
      TName,
      TArguments,
      NullabilityOf<TArguments[number]>,
      TSqlType
    >(name, ...args)
}
