import type {
  InheritedMetadata,
  MetadataOf,
  NullabilityOf,
  OutputOf,
  RequiresOf,
  RequiresSourceMeta,
  ResultMeta,
  SourceIdentity,
} from '../src/index.ts'
import type {
  aliasedRowNumber,
  mixedWindowCount,
  nullableWindow,
  partitionedRowNumber,
  posts,
  unconfiguredRank,
  users,
} from './window-functions-fixtures.ts'

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition

type UserIdentity = SourceIdentity<typeof users>
type PostIdentity = SourceIdentity<typeof posts>

export type PartitionedRowNumberOutput = Assert<
  Equal<OutputOf<typeof partitionedRowNumber>, number>
>

export type PartitionedRowNumberRequirements = Assert<
  Equal<RequiresOf<typeof partitionedRowNumber>, UserIdentity>
>

export type PartitionedRowNumberNullability = Assert<
  Equal<NullabilityOf<typeof partitionedRowNumber>, never>
>

export type MixedWindowRequirements = Assert<
  Equal<RequiresOf<typeof mixedWindowCount>, UserIdentity | PostIdentity>
>

export type MixedWindowMetadata = Assert<
  Equal<
    MetadataOf<typeof mixedWindowCount>,
    | ResultMeta<number, never>
    | RequiresSourceMeta<UserIdentity>
    | RequiresSourceMeta<PostIdentity>
  >
>

export type NullableWindowOutput = Assert<
  Equal<OutputOf<typeof nullableWindow>, string>
>

export type NullableWindowNullability = Assert<
  Equal<NullabilityOf<typeof nullableWindow>, PostIdentity>
>

export type NullableWindowInheritedMetadata = Assert<
  Equal<
    InheritedMetadata<typeof nullableWindow>,
    RequiresSourceMeta<UserIdentity> | RequiresSourceMeta<PostIdentity>
  >
>

export type UnconfiguredRankMetadata = Assert<
  Equal<MetadataOf<typeof unconfiguredRank>, ResultMeta<number, never>>
>

export type AliasedWindowOutput = Assert<
  Equal<OutputOf<typeof aliasedRowNumber>, number>
>
