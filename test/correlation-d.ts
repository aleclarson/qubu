import type {
  CardinalityOf,
  MetadataOf,
  OutputOf,
  ProvidesOuterOf,
  ProvidesSourceMeta,
  RequiresOf,
  RequiresOuterOf,
  RequiresOuterSourceMeta,
  SourceIdentity,
  SourceProvision,
  SourceRow,
} from "../src/index.ts"
import { crossJoin, from, select } from "../src/index.ts"
import {
  correlatedPost,
  correlatedScalar,
  lateralPost,
  lateralQuery,
  leftLateralQuery,
  localScalar,
  outerProvision,
  posts,
  users,
} from "./correlation-fixtures.ts"

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition

type UserIdentity = SourceIdentity<typeof users>
type LateralIdentity = SourceIdentity<typeof lateralPost>

export type OuterProvisionIsExplicit = Assert<
  Equal<ProvidesOuterOf<typeof outerProvision>, UserIdentity>
>

export type CorrelatedQueryRequiresItsEnclosingSource = Assert<
  Equal<RequiresOuterOf<typeof correlatedPost>, UserIdentity>
>

export type CorrelatedQueryConsumesItsLocalSource = Assert<
  Equal<RequiresOf<typeof correlatedPost>, never>
>

export type CorrelatedScalarPropagatesOuterRequirements = Assert<
  Equal<RequiresOuterOf<typeof correlatedScalar>, UserIdentity>
>

export type CorrelatedScalarOutputRemainsNullable = Assert<
  Equal<OutputOf<typeof correlatedScalar>, number | null>
>

export type CorrelatedQueryCardinalityRemainsQueryOnly = Assert<
  Equal<CardinalityOf<typeof correlatedPost>, "zero-or-one">
>

export type LateralSourceKeepsOuterRequirements = Assert<
  Equal<RequiresOuterOf<typeof lateralPost>, UserIdentity>
>

export type LateralSourceProvidesOnlyItsLocalIdentity = Assert<
  Equal<SourceProvision<typeof lateralPost>, ProvidesSourceMeta<LateralIdentity, { id: number }>>
>

export type LateralSourceRowRemainsPrecise = Assert<
  Equal<SourceRow<typeof lateralPost>, { id: number }>
>

export type LateralQueryConsumesOuterRequirements = Assert<
  Equal<RequiresOuterOf<typeof lateralQuery>, never>
>

export type LateralQueryOutputRemainsPrecise = Assert<
  Equal<
    typeof lateralQuery.row,
    {
      userId: number
      latestPostId: number
    }
  >
>

export type LateralLeftJoinKeepsNullability = Assert<
  Equal<typeof leftLateralQuery.row, { latestPostId: number | null }>
>

export type LocalSourcesDoNotEscapeThroughScalar = Assert<
  Equal<RequiresOuterOf<typeof localScalar>, never>
>

export type LocalScalarPreservesItsOutput = Assert<
  Equal<OutputOf<typeof localScalar>, number | null>
>

export type CorrelationMetadataIsTagged = Assert<
  Equal<
    Extract<MetadataOf<typeof correlatedPost>, { readonly kind: "requires-outer-source" }>,
    RequiresOuterSourceMeta<UserIdentity>
  >
>

// @ts-expect-error A correlated subquery must be consumed by a scope containing its outer source.
select({ value: correlatedScalar }, from(posts))

// @ts-expect-error A LATERAL source must be consumed by a scope containing its outer source.
select({ value: lateralPost.id }, from(posts), crossJoin(lateralPost))

// @ts-expect-error The local posts source inside the LATERAL query does not escape outward.
select({ value: posts.id }, from(users), crossJoin(lateralPost))

// @ts-expect-error Referencing an enclosing source requires an explicit correlate() provision.
select(
  {
    id: posts.id,
    authorId: users.id,
  },
  from(posts),
)
