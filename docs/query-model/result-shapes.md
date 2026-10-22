# Result shapes and cardinality

> Choose result fields and understand when a join or subquery can make them null.

## Name the selected row

An object projection uses its keys as result names:

```ts
import { from, integer, select, table, text, upper } from "qubu"

const users = table("users", {
  id: integer(),
  name: text(),
})

const query = select(
  {
    id: users.id,
    displayName: upper(users.name),
  },
  from(users),
)

type Row = typeof query.row
// { id: number; displayName: string }
```

The projection key also names the SQL output column. Use explicit fields for a
shaped result. Use `all(source)` when you want every source column. It
expands to named columns, so the SQL columns and inferred row keys stay aligned:

```ts
import { all, from, select, upper } from "qubu"

const query = select({ ...all(users), normalizedName: upper(users.name) }, from(users))
```

When a query becomes a CTE or derived table, its row shape becomes the columns
available from that new source. `RETURNING` uses the same projection rules.
See [Compose queries](../guides/compose-queries.md) and
[Write mutations](../guides/mutations.md) for those workflows.

The examples below continue with the `users` table from the first example.

## Account for nullable joins

`leftJoin()` marks the joined source as nullable. A selected column from that
source widens with `null`, while an expression with its own non-null result
contract can stay non-null:

```ts
import { count, eq, from, groupBy, integer, leftJoin, select, table, text } from "qubu"

const users = table("users", {
  id: integer(),
  name: text(),
})
const posts = table("posts", {
  id: integer(),
  authorId: integer(),
  title: text(),
})

const query = select(
  {
    userName: users.name,
    postTitle: posts.title,
    postCount: count(posts.id),
  },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  groupBy(users.name, posts.title),
)

type Row = typeof query.row
// { userName: string; postTitle: string | null; postCount: number }
```

The same rule applies inside expressions. `upper(posts.title)` remains
nullable because it depends on the joined row. `coalesce()` and a `CASE`
expression with non-null branches can return a non-null result.

Current inference handles outer-join widening only for `leftJoin()`.
`rightJoin()` and `fullJoin()` render their SQL forms without widening the
affected source fields. Account for their possible `NULL` values explicitly;
their inferred non-null fields are not a runtime guarantee.

## Check scalar cardinality

`scalar()` requires exactly one selected field. It does not enforce a row
limit: constrain the query when multiple rows are possible, or the database
may reject it (SQLite uses the first row). The result includes `null` unless
Qubu proves the query returns exactly one row:

```ts
import { fetchFirst, from, integer, scalar, select, table, value } from "qubu"

const users = table("users", { id: integer() })
const firstUser = select({ id: users.id }, from(users), fetchFirst(1))

const firstId = scalar(firstUser)
// OutputOf<typeof firstId> is number | null
```

`fetchFirst(1)` proves an upper bound, not that a row exists. A source-free
select is different:

```ts
const constant = select({ value: value(42) })
const constantValue = scalar(constant)
// OutputOf<typeof constantValue> is number
```

Qubu does not infer an upper bound from a unique-key predicate or exactness
from an aggregate over a source. An aggregate-only `SELECT COUNT(*) FROM ...`
is conservatively nullable through `scalar()` even though SQL returns one row
without `HAVING`. Source-free exactness also disappears when a filtering,
grouping, or pagination clause can remove its row.

## Keep SQL domains with the row

Projections preserve the SQL domains of their expressions. A text expression
stays `SqlText` through a CTE, derived table, scalar subquery, set operation, or
mutation `RETURNING` projection. See [SQL semantic types](../sql-semantic-types.md)
for the domain rules.

## Read next

- [Source scope](source-scope.md) explains why a column must come from `FROM`,
  a join, or an intentional correlation.
- [Fragments and metadata](fragments.md) explains how result and nullability
  facts move through custom composition.
