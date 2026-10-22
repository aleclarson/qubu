import {
  type CapabilityMetadataOf,
  type InheritedMetadata,
  type NullableSourceMeta,
  type RequiresOuterMetadataOf,
} from "../../core/fragment.ts"
import type { BooleanExpression } from "../../expressions/operators/comparison.ts"
import type { AnySource } from "../../schema/source.ts"
import type { ProvidedSourceIdentity } from "../../schema/source.ts"
import { createClause, type SelectClause } from "./types.ts"

export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL" | "CROSS" | "NATURAL"

export interface JoinClause<
  TSource extends AnySource = AnySource,
  TMetadata = never,
  TJoinType extends JoinType = JoinType,
> extends SelectClause<TMetadata> {
  readonly clauseKind: "join"
  readonly joinType: TJoinType
  readonly source: TSource
  readonly condition?: BooleanExpression<any>
}

type JoinMetadata<TSource extends AnySource, TCondition, TJoinType extends JoinType> =
  | InheritedMetadata<TCondition>
  | RequiresOuterMetadataOf<TSource>
  | CapabilityMetadataOf<TSource>
  | (TJoinType extends "LEFT" | "FULL"
      ? NullableSourceMeta<ProvidedSourceIdentity<TSource>>
      : never)

function join<
  const TJoinType extends JoinType,
  TSource extends AnySource,
  TCondition extends BooleanExpression<any> | undefined,
>(
  joinType: TJoinType,
  source: TSource,
  condition?: TCondition,
): JoinClause<TSource, JoinMetadata<TSource, TCondition, TJoinType>, TJoinType> {
  return Object.assign(
    createClause("join", "after-select", 40, (context) => {
      context.append(`${joinType} JOIN `)
      context.render(source)
      if (condition) {
        context.append(" ON ")
        context.render(condition)
      }
    }),
    {
      clauseKind: "join" as const,
      joinType,
      source,
      condition,
    },
  ) as JoinClause<TSource, JoinMetadata<TSource, TCondition, TJoinType>, TJoinType>
}

export function innerJoin<TSource extends AnySource, TCondition extends BooleanExpression<any>>(
  source: TSource,
  condition: TCondition,
) {
  return join("INNER", source, condition)
}

/** Add a LEFT JOIN, widening fields that depend on the joined source with null. */
export function leftJoin<TSource extends AnySource, TCondition extends BooleanExpression<any>>(
  source: TSource,
  condition: TCondition,
) {
  return join("LEFT", source, condition)
}

/** Add a RIGHT JOIN, widening fields from the preceding relation with null. */
export function rightJoin<TSource extends AnySource, TCondition extends BooleanExpression<any>>(
  source: TSource,
  condition: TCondition,
) {
  return join("RIGHT", source, condition)
}

/** Add a FULL JOIN, widening fields from both the preceding relation and joined source with null. */
export function fullJoin<TSource extends AnySource, TCondition extends BooleanExpression<any>>(
  source: TSource,
  condition: TCondition,
) {
  return join("FULL", source, condition)
}

export function crossJoin<TSource extends AnySource>(
  source: TSource,
): JoinClause<TSource, RequiresOuterMetadataOf<TSource> | CapabilityMetadataOf<TSource>, "CROSS"> {
  return join<"CROSS", TSource, undefined>("CROSS", source)
}

export function naturalJoin<TSource extends AnySource>(
  source: TSource,
): JoinClause<
  TSource,
  RequiresOuterMetadataOf<TSource> | CapabilityMetadataOf<TSource>,
  "NATURAL"
> {
  return join<"NATURAL", TSource, undefined>("NATURAL", source)
}
