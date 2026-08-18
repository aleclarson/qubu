import type {
  AggregateDependenciesOf,
  ColumnDependency,
  DependenciesOf,
  ExpressionMeta,
  MetadataOf,
  NullabilityOf,
  OutputOf,
  RequiresOf,
  ResultMeta,
  SourceIdentity,
  VisibleDependenciesOf,
} from '../src/index.ts'
import type {
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
type UserId = ColumnDependency<UserIdentity, 'id'>
type PostId = ColumnDependency<PostIdentity, 'id'>
type PostTitle = ColumnDependency<PostIdentity, 'title'>

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

export type MixedWindowDependencies = Assert<
  Equal<DependenciesOf<typeof mixedWindowCount>, UserId | PostId | PostTitle>
>

export type MixedWindowAggregateDependencies = Assert<
  Equal<AggregateDependenciesOf<typeof mixedWindowCount>, PostId>
>

export type MixedWindowVisibleDependencies = Assert<
  Equal<VisibleDependenciesOf<typeof mixedWindowCount>, UserId | PostTitle>
>

export type NullableWindowOutput = Assert<
  Equal<OutputOf<typeof nullableWindow>, string>
>

export type NullableWindowNullability = Assert<
  Equal<NullabilityOf<typeof nullableWindow>, PostIdentity>
>

export type NullableWindowInheritedMetadata = Assert<
  Equal<
    [RequiresOf<typeof nullableWindow>, DependenciesOf<typeof nullableWindow>],
    [UserIdentity | PostIdentity, UserId | PostTitle]
  >
>

export type UnconfiguredRankMetadata = Assert<
  Equal<
    MetadataOf<typeof unconfiguredRank>,
    ResultMeta<number, never> | ExpressionMeta<never>
  >
>
