# Result shapes and cardinality

> Choose a projection, understand how joins change its nullability, and check when a nested query can return no row.

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
shaped result. Reserve `all(source)` for a whole-source result contract. It
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
import { count, eq, from, integer, leftJoin, select, table, text } from "qubu"

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
)

type Row = typeof query.row
// { userName: string; postTitle: string | null; postCount: number }
```

The same rule applies inside expressions. `upper(posts.title)` remains
nullable because it depends on the joined row. `coalesce()` and a `CASE`
expression with non-null branches can return a non-null result.

## Check scalar cardinality

`scalar()` turns a query with exactly one selected field into an expression. The
result includes `null` when the query may return no rows:

```ts
import { fetchFirst, from, scalar, select, table, value } from "qubu"

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

Qubu does not infer exactness from a predicate such as `WHERE id = 1`. That
predicate can match no rows, so the scalar result remains nullable.

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
