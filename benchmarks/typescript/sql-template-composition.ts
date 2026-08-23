import {
  count,
  correlate,
  eq,
  from,
  groupBy,
  integer,
  leftJoin,
  over,
  select,
  sql,
  table,
  text,
  where,
  withDialectCapability,
} from 'qubu'
import type {
  CapabilitiesOf,
  ColumnDependency,
  DependenciesOf,
  HasAggregate,
  HasWindow,
  NullabilityOf,
  OutputOf,
  RequiresOuterOf,
  SourceIdentity,
  SqlBoolean,
  SqlInteger,
  SqlText,
  SqlTypeOf,
} from 'qubu'

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition

export const users = table('template_users', {
  id: integer(),
  name: text(),
})

export const posts = table('template_posts', {
  id: integer(),
  authorId: integer(),
  title: text(),
})

export const normalizedName = sql.type<string, SqlText>()`LOWER(${users.name})`

export const normalizedPostTitle = sql.type<
  string,
  SqlText
>()`LOWER(${posts.title})`

export const aggregatePostCount = sql.type<
  number,
  SqlInteger
>()`${count(posts.id)}`

export const windowedPostCount = sql.type<number, SqlInteger>()`${over(
  count(posts.id),
  { partitionBy: [users.id] }
)}`

export const selectedUserIds = select(
  { userId: users.id },
  from(users),
  groupBy(users.id)
)

export const queryTemplate = sql`EXISTS (${selectedUserIds})`

export const correlatedPostIds = select(
  { postId: posts.id },
  from(posts),
  correlate(users),
  where(eq(posts.authorId, users.id))
)

export const correlatedQueryTemplate = sql.type<
  boolean,
  SqlBoolean
>()`EXISTS (${correlatedPostIds})`

export const nestedTemplate = sql`${normalizedName}`

export const nestedTypedTemplate = sql.type<
  string,
  SqlText
>()`COALESCE(${nestedTemplate}, ${'unknown'})`

export const postgresPredicate = withDialectCapability(
  sql.type<boolean, SqlBoolean>()`${users.name} ILIKE ${'%ada%'}`,
  'ilike'
)

export const groupedTemplateQuery = select(
  {
    name: normalizedName,
    postCount: aggregatePostCount,
  },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  groupBy(normalizedName)
)

export const leftJoinedTemplateQuery = select(
  { title: normalizedPostTitle },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId))
)

type UserIdentity = SourceIdentity<typeof users>
type PostIdentity = SourceIdentity<typeof posts>
type UserId = ColumnDependency<UserIdentity, 'id'>
type PostId = ColumnDependency<PostIdentity, 'id'>

export type NestedTemplateMetadata = Assert<
  Equal<
    [
      OutputOf<typeof nestedTypedTemplate>,
      SqlTypeOf<typeof nestedTypedTemplate>,
    ],
    [string, SqlText]
  >
>

export type NestedTemplateDependencies = Assert<
  Equal<
    DependenciesOf<typeof nestedTypedTemplate>,
    ColumnDependency<UserIdentity, 'name'>
  >
>

export type WindowedTemplateMetadata = Assert<
  Equal<
    [
      HasAggregate<typeof windowedPostCount>,
      HasWindow<typeof windowedPostCount>,
      DependenciesOf<typeof windowedPostCount>,
    ],
    [true, true, UserId | PostId]
  >
>

export type CorrelatedTemplateScope = Assert<
  Equal<RequiresOuterOf<typeof correlatedQueryTemplate>, UserIdentity>
>

export type GroupedTemplateOutput = Assert<
  Equal<typeof groupedTemplateQuery.row, { name: string; postCount: number }>
>

export type LeftJoinedTemplateNullability = Assert<
  Equal<NullabilityOf<typeof normalizedPostTitle>, PostIdentity>
>

export type LeftJoinedTemplateOutput = Assert<
  Equal<typeof leftJoinedTemplateQuery.row, { title: string | null }>
>

export type CapabilityBearingTemplate = Assert<
  Equal<CapabilitiesOf<typeof postgresPredicate>, 'ilike'>
>
