# Group and rank rows

> Use aggregates, grouping, and window expressions while preserving the dependencies and result types that make each expression valid.

The examples use the `users` and `posts` tables from [Build a
`SELECT`](overview.md).

## Group and aggregate

Object projection keys provide stable names for aggregates. Group every
non-aggregate column dependency:

```ts
import { count, desc, eq, from, groupBy, gt, having, leftJoin, orderBy, select } from "qubu"

const counts = select(
  {
    name: users.name,
    postCount: count(posts.id),
  },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  groupBy(users.name),
  having(gt(count(posts.id), 0)),
  orderBy(desc(count(posts.id))),
)
```

`users.name` is grouped, while `posts.id` is consumed by `COUNT()`. The
same dependency rule applies to `HAVING` and grouped `ORDER BY` expressions.
A projection such as `{ email: users.email, postCount: count(posts.id) }` is
rejected unless `users.email` is grouped or is functionally determined by a
grouped primary or unique key declared in the table schema. Qubu uses only
explicit key metadata and keeps the proof within the source boundary. See
[Constraints, keys, and indexes](../../schema/constraints-and-indexes.md#use-key-metadata-for-grouped-queries).

## Window functions

Use `over()` to attach an inline window specification to a typed expression.
The initial window scope supports `PARTITION BY` and `ORDER BY`; the same
`asc()` and `desc()` terms used by a query-level `orderBy()` can be reused:

```ts
import { desc, from, over, rowNumber, select } from "qubu"

const rankedUsers = select(
  {
    id: users.id,
    rowNumber: over(rowNumber(), {
      partitionBy: [users.name],
      orderBy: [desc(users.id)],
    }),
  },
  from(users),
)
```

Window expressions remain ordinary expressions. They can be projected, aliased,
and passed to `orderBy()`. Their source requirements and result types are
retained through `over()`, and values rendered inside the window
specification remain parameters. Named windows and frame clauses are outside
the initial inline scope.

## Read next

- [Order and paginate](ordering-and-pagination.md) covers stable ordering and
  row limits.
- [Compose queries](../compose-queries.md) covers CTEs, derived tables, scalar
  subqueries, and set operations.
- [Result shapes and cardinality](../../query-model/result-shapes.md) explains
  the row and scalar types produced by nested queries.
