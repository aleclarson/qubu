import type {
  CardinalityMeta,
  CardinalityOf,
  InheritedMetadata,
  MetadataOf,
  NullabilityOf,
  OutputOf,
  QueryCardinality,
  Query,
  QueryRow,
  ResultMeta,
} from "../src/index.ts"
import type {
  conditionalLimitedQuery,
  conditionalNextLimitedQuery,
  conditionalOffsetQuery,
  exactQuery,
  exactScalar,
  filteredConstantQuery,
  filteredConstantScalar,
  limitedQuery,
  limitedScalar,
  nextLimitedQuery,
  nextLimitedScalar,
  ordinaryQuery,
  ordinaryScalar,
  wideLimitQuery,
} from "./cardinality-fixtures.ts"

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition
type NotEqual<TLeft, TRight> = Equal<TLeft, TRight> extends true ? false : true

type UserRow = { id: number }

type SparseQuery = Query<{ readonly row: UserRow }>

export type SparseQueryDefaults = Assert<
  Equal<
    [QueryRow<SparseQuery>, CardinalityOf<SparseQuery>, MetadataOf<SparseQuery>],
    [UserRow, QueryCardinality, ResultMeta<readonly UserRow[]> | CardinalityMeta<QueryCardinality>]
  >
>

// @ts-expect-error Query cardinality must use Qubu's cardinality vocabulary.
type InvalidQueryConfig = Query<{ readonly cardinality: "once" }>

export type CardinalityVocabulary = Assert<
  Equal<QueryCardinality, "many" | "zero-or-one" | "exactly-one">
>

export type OrdinaryCardinality = Assert<Equal<CardinalityOf<typeof ordinaryQuery>, "many">>

export type OrdinaryMetadata = Assert<
  Equal<MetadataOf<typeof ordinaryQuery>, ResultMeta<readonly UserRow[]> | CardinalityMeta<"many">>
>

export type SpecializedQueryRemainsAssignableToThePublicQueryShape = Assert<
  typeof exactQuery extends Query<{ readonly row: { value: number } }> ? true : false
>

export type LimitedCardinality = Assert<Equal<CardinalityOf<typeof limitedQuery>, "zero-or-one">>

export type NextLimitedCardinality = Assert<
  Equal<CardinalityOf<typeof nextLimitedQuery>, "zero-or-one">
>

export type WideLimitRemainsConservative = Assert<
  Equal<CardinalityOf<typeof wideLimitQuery>, "many">
>

export type ConditionalLimitRemainsConservative = Assert<
  Equal<CardinalityOf<typeof conditionalLimitedQuery>, "many">
>

export type ConditionalNextLimitRemainsConservative = Assert<
  Equal<CardinalityOf<typeof conditionalNextLimitedQuery>, "many">
>

export type ConditionalOffsetRemainsConservative = Assert<
  Equal<CardinalityOf<typeof conditionalOffsetQuery>, "many">
>

export type ExactCardinality = Assert<Equal<CardinalityOf<typeof exactQuery>, "exactly-one">>

export type CardinalityStaysAtTheQueryBoundary = Assert<
  Equal<InheritedMetadata<typeof exactQuery>, never>
>

export type PredicateDoesNotProveExactness = Assert<
  Equal<CardinalityOf<typeof filteredConstantQuery>, "many">
>

export type OrdinaryScalarOutput = Assert<Equal<OutputOf<typeof ordinaryScalar>, number | null>>

export type LimitedScalarOutput = Assert<Equal<OutputOf<typeof limitedScalar>, number | null>>

export type ScalarRowAbsenceIsNotJoinNullability = Assert<
  Equal<NullabilityOf<typeof limitedScalar>, never>
>

export type NextLimitedScalarOutput = Assert<
  Equal<OutputOf<typeof nextLimitedScalar>, number | null>
>

export type ExactScalarOutput = Assert<Equal<OutputOf<typeof exactScalar>, number>>

export type PredicateScalarRemainsNullable = Assert<
  NotEqual<OutputOf<typeof filteredConstantScalar>, number>
>

export type OrdinaryScalarDoesNotAssumeARow = Assert<
  NotEqual<OutputOf<typeof ordinaryScalar>, number>
>
