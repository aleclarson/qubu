import { schemaCall } from './call.ts'
import type { Operand } from '../operators/shared.ts'
import type { ExpressionWithOutput } from '../types.ts'
import type { ExpressionSqlType } from '../types.ts'
import type { SqlText, SqlTextLike } from '../../core/sql-types.ts'
import type {
  OperandSqlType,
  SqlCapabilityValidation,
  SqlEqualityValidation,
} from '../operators/shared.ts'

type TextArgumentsValidation<TArguments extends readonly unknown[]> =
  TArguments extends readonly [infer THead, ...infer TTail]
    ? SqlCapabilityValidation<OperandSqlType<THead, SqlText>, SqlTextLike> &
        TextArgumentsValidation<TTail>
    : unknown

type CoalesceValidation<
  TFirst,
  TRest extends readonly unknown[],
> = TRest extends readonly [infer THead, ...infer TTail]
  ? SqlEqualityValidation<ExpressionSqlType<TFirst>, ExpressionSqlType<THead>> &
      CoalesceValidation<TFirst, TTail>
  : unknown

export function lower<TExpression extends ExpressionWithOutput<string>>(
  expression: TExpression &
    SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlTextLike>
) {
  return schemaCall<
    string,
    'LOWER',
    [TExpression],
    import('../../core/fragment.ts').NullabilityOf<TExpression>,
    SqlText
  >('LOWER', expression)
}

export function upper<TExpression extends ExpressionWithOutput<string>>(
  expression: TExpression &
    SqlCapabilityValidation<ExpressionSqlType<TExpression>, SqlTextLike>
) {
  return schemaCall<
    string,
    'UPPER',
    [TExpression],
    import('../../core/fragment.ts').NullabilityOf<TExpression>,
    SqlText
  >('UPPER', expression)
}

export function coalesce<
  T,
  const TExpressions extends readonly [
    ExpressionWithOutput<T>,
    ...ExpressionWithOutput<T>[],
  ],
>(
  ...expressions: TExpressions &
    CoalesceValidation<
      TExpressions[0],
      TExpressions extends readonly [any, ...infer TRest] ? TRest : never
    >
) {
  return schemaCall<
    T,
    'COALESCE',
    TExpressions,
    never,
    ExpressionSqlType<TExpressions[0]>
  >('COALESCE', ...(expressions as TExpressions))
}

export function concat<const TArguments extends readonly Operand<string>[]>(
  ...argumentsToConcat: TArguments & TextArgumentsValidation<TArguments>
) {
  return schemaCall<
    string,
    'CONCAT',
    TArguments,
    import('../../core/fragment.ts').NullabilityOf<TArguments[number]>,
    SqlText
  >('CONCAT', ...(argumentsToConcat as TArguments))
}
