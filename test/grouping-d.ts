import type {
  AggregateDependenciesOf,
  ColumnDependency,
  DependenciesOf,
  GroupingDependenciesOf,
  GroupingKeysOf,
  OutputOf,
  SourceIdentity,
  VisibleDependenciesOf,
} from '../src/index.ts'
import {
  all,
  count,
  eq,
  from,
  groupBy,
  having,
  leftJoin,
  select,
} from '../src/index.ts'
import {
  groupedByColumn,
  groupedByColumnClause,
  groupedByExpression,
  groupedPostTotal,
  groupedWithWindow,
  posts,
  users,
} from './grouping-fixtures.ts'

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition

type UserIdentity = SourceIdentity<typeof users>
type UserName = ColumnDependency<UserIdentity, 'name'>
type PostIdentity = SourceIdentity<typeof posts>
type PostId = ColumnDependency<PostIdentity, 'id'>

export type GroupingKeyFacts = Assert<
  Equal<GroupingKeysOf<typeof groupedByColumnClause>, typeof users.name>
>

export type GroupingDependencyFacts = Assert<
  Equal<GroupingDependenciesOf<typeof groupedByColumnClause>, UserName>
>

export type GroupedProjectionOutput = Assert<
  Equal<
    typeof groupedByColumn.row,
    {
      name: string
      displayName: string
      postCount: number
      postTotal: number | null
    }
  >
>
export type AggregateDependencyFacts = Assert<
  Equal<AggregateDependenciesOf<typeof groupedPostTotal>, PostId>
>

export type AggregateVisibleDependencyFacts = Assert<
  Equal<VisibleDependenciesOf<typeof groupedPostTotal>, never>
>

export type GroupedProjectionDependencies = Assert<
  Equal<DependenciesOf<typeof groupedByColumn>, never>
>

export type ExactExpressionGroupingOutput = Assert<
  Equal<
    OutputOf<typeof groupedByExpression>,
    readonly { displayName: string }[]
  >
>

export type WindowGroupingOutput = Assert<
  Equal<
    typeof groupedWithWindow.row,
    {
      name: string
      rowNumber: number
      totalPosts: number
    }
  >
>

select(
  {
    name: users.name,
    postCount: count(posts.id),
  },
  // @ts-expect-error A selected column must be grouped when the query contains an aggregate.
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  groupBy(users.id)
)

select(
  {
    name: users.name,
    postCount: count(posts.id),
  },
  // @ts-expect-error HAVING cannot reference a dependency that is not grouped.
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  groupBy(users.name),
  having(eq(posts.title, 'draft'))
)

select(
  all(users),
  // @ts-expect-error Every selected column must be grouped in an aggregate query.
  from(users),
  groupBy(users.id)
)

select(
  { total: count(users.id) },
  // @ts-expect-error GROUP BY cannot contain an aggregate expression.
  from(users),
  groupBy(count(users.id))
)
