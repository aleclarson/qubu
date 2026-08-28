import { postgresDialect } from "../src/dialects/postgres.ts"
import { sqliteDialect } from "../src/dialects/sqlite.ts"
import { from, groupBy, render, select, sql } from "../src/index.ts"
import type {
  AggregateDependenciesOf,
  CapabilitiesOf,
  ColumnDependency,
  DependenciesOf,
  HasAggregate,
  HasSubquery,
  HasWindow,
  NullabilityOf,
  OutputOf,
  RequiresOf,
  RequiresOuterOf,
  SourceIdentity,
  SqlInteger,
  SqlText,
  SqlTypeOf,
  SqlUnknown,
  VisibleDependenciesOf,
} from "../src/index.ts"
import {
  aggregatePostCount,
  correlatedQueryTemplate,
  groupedTemplateQuery,
  leftJoinedTemplateQuery,
  nestedTemplate,
  normalizedName,
  normalizedPostTitle,
  posts,
  postgresPredicate,
  queryTemplate,
  untypedTemplate,
  users,
  windowedPostCount,
} from "./sql-template-fixtures.ts"

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition

type UserIdentity = SourceIdentity<typeof users>
type PostIdentity = SourceIdentity<typeof posts>
type UserId = ColumnDependency<UserIdentity, "id">
type UserName = ColumnDependency<UserIdentity, "name">
type PostId = ColumnDependency<PostIdentity, "id">

export type TemplateDefaultsAreUnknown = Assert<
  Equal<
    [OutputOf<typeof untypedTemplate>, SqlTypeOf<typeof untypedTemplate>],
    [unknown, SqlUnknown]
  >
>

export type DeclaredTemplateDomain = Assert<
  Equal<[OutputOf<typeof normalizedName>, SqlTypeOf<typeof normalizedName>], [string, SqlText]>
>

export type TemplateScopeAndDependencies = Assert<
  Equal<
    [RequiresOf<typeof normalizedName>, DependenciesOf<typeof nestedTemplate>],
    [UserIdentity, UserName]
  >
>

export type TemplateNullabilityIsConservative = Assert<
  Equal<NullabilityOf<typeof normalizedPostTitle>, PostIdentity>
>

export type LeftJoinedTemplateOutput = Assert<
  Equal<typeof leftJoinedTemplateQuery.row, { title: string | null }>
>

export type AggregateTemplateMetadata = Assert<
  Equal<
    [
      HasAggregate<typeof aggregatePostCount>,
      DependenciesOf<typeof aggregatePostCount>,
      AggregateDependenciesOf<typeof aggregatePostCount>,
      VisibleDependenciesOf<typeof aggregatePostCount>,
      SqlTypeOf<typeof aggregatePostCount>,
    ],
    [true, PostId, PostId, never, SqlInteger]
  >
>

export type WindowTemplateMetadata = Assert<
  Equal<
    [
      HasAggregate<typeof windowedPostCount>,
      HasWindow<typeof windowedPostCount>,
      DependenciesOf<typeof windowedPostCount>,
    ],
    [true, true, UserId | PostId]
  >
>

export type QueryInterpolationIsASubquery = Assert<Equal<HasSubquery<typeof queryTemplate>, true>>

export type CorrelatedQueryScopeIsInherited = Assert<
  Equal<RequiresOuterOf<typeof correlatedQueryTemplate>, UserIdentity>
>

export type TemplateCapabilityRequirements = Assert<
  Equal<CapabilitiesOf<typeof postgresPredicate>, "ilike">
>

export type GroupedTemplateOutput = Assert<
  Equal<
    typeof groupedTemplateQuery.row,
    {
      name: string
      postCount: number
    }
  >
>

render(postgresPredicate, postgresDialect())

select({ hasPosts: correlatedQueryTemplate }, from(users))

select(
  { hasPosts: correlatedQueryTemplate },
  // @ts-expect-error A correlated query interpolation retains its outer source requirement.
  from(posts),
)

// @ts-expect-error The default dialect does not support the inherited ILIKE capability.
render(postgresPredicate)

// @ts-expect-error SQLite does not support the inherited ILIKE capability.
render(postgresPredicate, sqliteDialect())

select(
  { name: normalizedName },
  // @ts-expect-error A template keeps the source requirement of an interpolated column.
  from(posts),
)

select(
  {
    name: normalizedName,
    postCount: aggregatePostCount,
  },
  // @ts-expect-error The interpolated name dependency must be grouped.
  from(users),
  groupBy(users.id),
)

const outputOnly = sql.type<string>()`custom_text(${users.name})`

export type OutputOnlyDomainRemainsUnknown = Assert<Equal<SqlTypeOf<typeof outputOnly>, SqlUnknown>>
