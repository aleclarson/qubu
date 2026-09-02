import type {
  DependenciesOf,
  ExpressionMeta,
  InheritedMetadata,
  NullabilityOf,
  ResultMeta,
  SqlTypeOf,
} from "../core/fragment.ts"
import { resultValue, resultValueOf, type ResultDecoder } from "../result.ts"
import {
  isSchemaExpression,
  makeExpression,
  markSchemaExpression,
  type AnyExpression,
  type AnySchemaExpression,
  type Expression,
  type ExpressionOutput,
  type SchemaExpression,
} from "./types.ts"

type MappedOutput<TOutput, TExpression> = TOutput | Extract<ExpressionOutput<TExpression>, null>

type MappedResultMetadata<TOutput, TExpression> =
  | ResultMeta<
      MappedOutput<TOutput, TExpression>,
      NullabilityOf<TExpression>,
      SqlTypeOf<TExpression>
    >
  | ExpressionMeta<DependenciesOf<TExpression>>
  | InheritedMetadata<TExpression>

/** Attach an application decoder to an expression without changing its SQL. */
export function mapResult<TOutput, TExpression extends AnyExpression>(
  expression: TExpression,
  decoder: ResultDecoder<TOutput>,
): TExpression extends AnySchemaExpression
  ? SchemaExpression<MappedResultMetadata<TOutput, TExpression>, TExpression["expressionKind"]>
  : Expression<MappedResultMetadata<TOutput, TExpression>, TExpression["expressionKind"]> {
  const metadata = resultValueOf(expression)
  const mapped = makeExpression<
    MappedResultMetadata<TOutput, TExpression>,
    TExpression["expressionKind"]
  >(
    expression.expressionKind,
    (context) => context.render(expression),
    expression.expressionCategory,
    resultValue(metadata?.type, decoder, metadata?.sqlType),
  )

  return (
    isSchemaExpression(expression) ? markSchemaExpression(mapped) : mapped
  ) as TExpression extends AnySchemaExpression
    ? SchemaExpression<MappedResultMetadata<TOutput, TExpression>, TExpression["expressionKind"]>
    : Expression<MappedResultMetadata<TOutput, TExpression>, TExpression["expressionKind"]>
}
