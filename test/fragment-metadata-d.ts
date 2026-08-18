import type {
  AggregateDependenciesOf,
  AggregateMeta,
  ColumnDependency,
  CardinalityMeta,
  DependenciesOf,
  ExpressionMeta,
  FragmentMeta,
  GroupingMeta,
  MetadataOf,
  NullabilityOf,
  NullableSourceMeta,
  NullableSourcesOf,
  OutputOf,
  ProvidesSourceMeta,
  QueryCardinality,
  RequiresOf,
  RequiresSourceMeta,
  ResultMeta,
  SourceIdentity,
  VisibleDependenciesOf,
} from '../src/index.ts'
import type {
  commaSeparatedColumns,
  coalescedPostTitle,
  countedPostIds,
  distinctPostIds,
  expressionWrappedColumn,
  keywordColumn,
  leftJoinClause,
  leftJoinedQuery,
  literalCase,
  metadataFreeSequence,
  mixedSourceSequence,
  notNullPredicate,
  nullPredicate,
  parenthesizedColumn,
  posts,
  sequenceWithJoin,
  sourceAwareSequence,
  upperPostTitle,
  users,
} from './fragment-metadata-fixtures.ts'

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition

type UserIdentity = SourceIdentity<typeof users>
type PostIdentity = SourceIdentity<typeof posts>

export type SourceAwareSequenceMetadata = Assert<
  Equal<
    [
      RequiresOf<typeof sourceAwareSequence>,
      DependenciesOf<typeof sourceAwareSequence>,
    ],
    [UserIdentity, ColumnDependency<UserIdentity, 'name'>]
  >
>

export type MixedSequenceRequirements = Assert<
  Equal<RequiresOf<typeof mixedSourceSequence>, UserIdentity | PostIdentity>
>

export type MetadataFreeComposition = Assert<
  Equal<MetadataOf<typeof metadataFreeSequence>, never>
>

export type MetadataFreeOutput = Assert<
  Equal<OutputOf<typeof metadataFreeSequence>, never>
>

export type MetadataFreeNullability = Assert<
  Equal<NullabilityOf<typeof metadataFreeSequence>, never>
>

export type ParenthesizedMetadata = Assert<
  Equal<
    DependenciesOf<typeof parenthesizedColumn>,
    ColumnDependency<PostIdentity, 'title'>
  >
>

export type KeywordMetadata = Assert<
  Equal<
    DependenciesOf<typeof keywordColumn>,
    ColumnDependency<PostIdentity, 'title'>
  >
>

export type CommaSeparatedRequirements = Assert<
  Equal<RequiresOf<typeof commaSeparatedColumns>, UserIdentity | PostIdentity>
>

export type ExpressionWrapperMetadata = Assert<
  Equal<
    MetadataOf<typeof expressionWrappedColumn>,
    MetadataOf<typeof posts.title>
  >
>

export type SourceRequirementPropagation = Assert<
  Equal<RequiresOf<typeof upperPostTitle>, PostIdentity>
>

export type UpperPostTitleOutput = Assert<
  Equal<OutputOf<typeof upperPostTitle>, string>
>
export type CountOutput = Assert<Equal<OutputOf<typeof countedPostIds>, number>>
export type CountDistinctOutput = Assert<
  Equal<OutputOf<typeof distinctPostIds>, number>
>
export type CountDependencies = Assert<
  Equal<
    DependenciesOf<typeof countedPostIds>,
    ColumnDependency<PostIdentity, 'id'>
  >
>
export type CountAggregateDependencies = Assert<
  Equal<
    AggregateDependenciesOf<typeof countedPostIds>,
    ColumnDependency<PostIdentity, 'id'>
  >
>
export type CountVisibleDependencies = Assert<
  Equal<VisibleDependenciesOf<typeof countedPostIds>, never>
>
export type NullPredicateOutput = Assert<
  Equal<OutputOf<typeof nullPredicate>, boolean>
>
export type NotNullPredicateOutput = Assert<
  Equal<OutputOf<typeof notNullPredicate>, boolean>
>

export type NullableJoinMetadata = Assert<
  Equal<
    [
      RequiresOf<typeof leftJoinClause>,
      DependenciesOf<typeof leftJoinClause>,
      NullableSourcesOf<typeof leftJoinClause>,
    ],
    [
      UserIdentity | PostIdentity,
      (
        | ColumnDependency<UserIdentity, 'id'>
        | ColumnDependency<PostIdentity, 'authorId'>
      ),
      PostIdentity,
    ]
  >
>

export type NullableJoinSources = Assert<
  Equal<NullableSourcesOf<typeof leftJoinClause>, PostIdentity>
>

export type JoinedExpressionNullability = Assert<
  Equal<NullabilityOf<typeof upperPostTitle>, PostIdentity>
>

export type SemanticNullabilityOverrides = Assert<
  Equal<
    [
      NullabilityOf<typeof countedPostIds>,
      NullabilityOf<typeof distinctPostIds>,
      NullabilityOf<typeof coalescedPostTitle>,
      NullabilityOf<typeof literalCase>,
      NullabilityOf<typeof nullPredicate>,
      NullabilityOf<typeof notNullPredicate>,
    ],
    [never, never, never, never, never, never]
  >
>

export type JoinComposition = Assert<
  Equal<
    [RequiresOf<typeof leftJoinClause>, DependenciesOf<typeof leftJoinClause>],
    [
      UserIdentity | PostIdentity,
      (
        | ColumnDependency<UserIdentity, 'id'>
        | ColumnDependency<PostIdentity, 'authorId'>
      ),
    ]
  >
>

export type SequenceJoinMetadata = Assert<
  Equal<
    [
      RequiresOf<typeof sequenceWithJoin>,
      DependenciesOf<typeof sequenceWithJoin>,
      NullableSourcesOf<typeof sequenceWithJoin>,
    ],
    [
      UserIdentity | PostIdentity,
      (
        | ColumnDependency<UserIdentity, 'id'>
        | ColumnDependency<UserIdentity, 'name'>
        | ColumnDependency<PostIdentity, 'authorId'>
      ),
      PostIdentity,
    ]
  >
>

type JoinedRow = {
  postTitle: string | null
  postTitleUpper: string | null
  postCount: number
  postCountDistinct: number
  postIsMissing: boolean
  postIsPresent: boolean
}

export type ConcreteSelectionOutput = Assert<
  Equal<typeof leftJoinedQuery.row, JoinedRow>
>

export type ConcreteQueryOutput = Assert<
  Equal<OutputOf<typeof leftJoinedQuery>, readonly JoinedRow[]>
>

export type PublicMetadataUnionIsClosedForCurrentFacts = Assert<
  Equal<
    FragmentMeta,
    | ResultMeta<unknown, unknown>
    | RequiresSourceMeta<unknown>
    | NullableSourceMeta<unknown>
    | ProvidesSourceMeta<unknown, unknown>
    | ExpressionMeta<unknown>
    | AggregateMeta<unknown>
    | GroupingMeta<unknown, unknown>
    | CardinalityMeta<QueryCardinality>
  >
>
