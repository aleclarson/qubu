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
} from "qubu"
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
} from "qubu"
import { withDialectCapability } from "qubu/core"

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition

export const users = table("template_users", {
  id: integer(),
  name: text(),
})

export const posts = table("template_posts", {
  id: integer(),
  authorId: integer(),
  title: text(),
})

export const normalizedName = sql`LOWER(${users.name})`.$type<string, SqlText>()

export const normalizedPostTitle = sql`LOWER(${posts.title})`.$type<string, SqlText>()

export const aggregatePostCount = sql`${count(posts.id)}`.$type<number, SqlInteger>()

export const windowedPostCount = sql`${over(count(posts.id), {
  partitionBy: [users.id],
})}`.$type<number, SqlInteger>()

export const selectedUserIds = select({ userId: users.id }, from(users), groupBy(users.id))

export const queryTemplate = sql`EXISTS (${selectedUserIds})`

export const correlatedPostIds = select(
  { postId: posts.id },
  from(posts),
  correlate(users),
  where(eq(posts.authorId, users.id)),
)

export const correlatedQueryTemplate = sql`EXISTS (${correlatedPostIds})`.$type<
  boolean,
  SqlBoolean
>()

export const nestedTemplate = sql`${normalizedName}`

export const nestedTypedTemplate = sql`COALESCE(${nestedTemplate}, ${"unknown"})`.$type<
  string,
  SqlText
>()

export const postgresPredicate = withDialectCapability(
  sql`${users.name} ILIKE ${"%ada%"}`.$type<boolean, SqlBoolean>(),
  "ilike",
)

export const groupedTemplateQuery = select(
  {
    name: normalizedName,
    postCount: aggregatePostCount,
  },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  groupBy(normalizedName),
)

export const leftJoinedTemplateQuery = select(
  { title: normalizedPostTitle },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
)

type UserIdentity = SourceIdentity<typeof users>
type PostIdentity = SourceIdentity<typeof posts>
type UserId = ColumnDependency<UserIdentity, "id">
type PostId = ColumnDependency<PostIdentity, "id">

export type NestedTemplateMetadata = Assert<
  Equal<
    [OutputOf<typeof nestedTypedTemplate>, SqlTypeOf<typeof nestedTypedTemplate>],
    [string, SqlText]
  >
>

export type NestedTemplateDependencies = Assert<
  Equal<DependenciesOf<typeof nestedTypedTemplate>, ColumnDependency<UserIdentity, "name">>
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
  Equal<
    typeof groupedTemplateQuery.row,
    {
      name: string
      postCount: number
    }
  >
>

export type LeftJoinedTemplateNullability = Assert<
  Equal<NullabilityOf<typeof normalizedPostTitle>, PostIdentity>
>

export type LeftJoinedTemplateOutput = Assert<
  Equal<typeof leftJoinedTemplateQuery.row, { title: string | null }>
>

export type CapabilityBearingTemplate = Assert<
  Equal<CapabilitiesOf<typeof postgresPredicate>, "ilike">
>
