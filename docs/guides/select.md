# Build a `SELECT`

> Turn typed table values into readable, parameterized `SELECT` statements while keeping filters, joins, and result shapes visible.

## Start with a projection and a source

The first argument to `select()` is the projection. The remaining arguments are
independent clauses. A source-aware column must be provided by `from()` or a
join:

```ts
import { eq, from, integer, render, select, table, text, where } from 'qubu'

const users = table('users', {
  id: integer(),
  name: text(),
  email: text({ nullable: true }),
})

const query = select(
  { id: users.id, name: users.name },
  from(users),
  where(eq(users.id, 7))
)

render(query).text
// SELECT "users"."id" AS "id", "users"."name" AS "name" FROM "users" WHERE ("users"."id" = ?)
```

An object projection uses its keys as result names. `all(source)` returns the
source's columns as a named projection object, so it can be spread alongside
computed expressions:

```ts
import { all, from, select, upper } from 'qubu'

select({ ...all(users), normalizedName: upper(users.name) }, from(users))
```

`all(source)` expands to explicit named columns rather than emitting `source.*`.
That keeps the SQL output and the inferred row keys aligned.

Named object projections keep the row shape visible at the selection site,
which is useful when the result is consumed by application code.

## Add joins and predicates

Join functions add a source and make the join condition part of the same scope
check as the projection and `WHERE` clause:

```ts
import { count, innerJoin, isNotNull, leftJoin } from 'qubu'

const posts = table('posts', {
  id: integer(),
  authorId: integer(),
  title: text(),
})

const query = select(
  { userId: users.id, title: posts.title },
  from(users),
  innerJoin(posts, eq(users.id, posts.authorId)),
  where(isNotNull(users.email))
)
```

Use `innerJoin`, `leftJoin`, `rightJoin`, or `fullJoin` with an `ON` condition.
`crossJoin` and `naturalJoin` add a source without a condition; use them only
when that SQL behavior is intentional.

`leftJoin()` also carries nullability into the selected row. A column from the
joined source is nullable because the row may be missing, while an expression
with a deliberately non-nullable result such as `count()` remains non-null:

```ts
const summary = select(
  {
    userName: users.name,
    postTitle: posts.title,
    postCount: count(posts.id),
  },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId))
)

// typeof summary.row:
// { userName: string; postTitle: string | null; postCount: number }
```

Compose boolean expressions explicitly:

```ts
import { and, gt, inList, or } from 'qubu'

const filter = and(
  gt(users.id, 0),
  or(inList(users.id, [7, 8]), eq(users.name, 'Ada'))
)

const filtered = select(
  { id: users.id, name: users.name },
  from(users),
  where(filter)
)
```

Values such as `7`, `'Ada'`, and list members become parameters. They are not
interpolated into SQL.

## Omit query parts conditionally

Use `omit` as the other branch of a JavaScript conditional when a `WHERE`,
`HAVING`, `ORDER BY`, or `DISTINCT` clause is optional:

```ts
import { eq, from, omit, select, where } from 'qubu'

declare const userId: number | undefined

const query = select(
  { id: users.id, name: users.name },
  from(users),
  userId === undefined ? omit : where(eq(users.id, userId))
)
```

The ordinary ternary narrows `userId`, and the unused clause is never built.
Qubu removes `omit` before validating and ordering the remaining clauses.

Use the same token inside `and()`, `or()`, and `orderBy()` when individual
predicates or ordering terms are conditional:

```ts
import { and, desc, eq, omit, orderBy, where } from 'qubu'

declare const includeName: boolean
declare const newestFirst: boolean

const filter = where(
  and(eq(users.id, 7), includeName ? eq(users.name, 'Ada') : omit)
)
const ordering = orderBy(newestFirst ? desc(users.name) : omit)
```

Each helper removes omitted members while retaining the source and grouping
requirements of every member that may be present. If no predicate remains,
`and()` or `or()` propagates `omit` through `where()` or `having()`; if no
ordering term remains, `orderBy()` propagates `omit` directly. The resulting
query emits no empty clause.

The same token can conditionally include a projection field:

```ts
declare const includeEmail: boolean

const query = select(
  {
    id: users.id,
    email: includeEmail ? users.email : omit,
  },
  from(users)
)

// typeof query.row:
// { id: number; email?: string | null }
```

Here `omit` affects only whether `email` belongs to the projection. It does not
make the expression nullable: a non-nullable expression would produce
`email?: string`, while this nullable column produces `email?: string | null`.

This support is specific to boolean operand lists, query-level ordering terms,
and the complete clauses named above. Generic `sequence()` and
`commaSeparated()` collections do not discard `omit`. Clauses that provide
sources or change structural guarantees cannot be conditional. Qubu rejects
`omit` branches paired with `from()`, joins, `groupBy()`, pagination,
correlation, CTEs, or custom clauses. Build separate queries when those parts
differ at runtime.

## Handle `NULL` and empty lists deliberately

Equality with `null` is translated to the SQL null predicate:

```ts
import { eq, isDistinctFrom, ne } from 'qubu'

eq(users.name, null) // ... IS NULL
ne(users.name, null) // ... IS NOT NULL
isDistinctFrom(users.name, null) // ... IS DISTINCT FROM ?
```

Relational comparisons such as `gt(users.id, null)` are rejected because SQL
does not give them ordinary boolean comparison semantics. Use `isNull`,
`isNotNull`, or a distinctness predicate when that is the intended operation.

Empty membership lists remain valid and portable:

```ts
inList(users.id, []) // (1 = 0)
notIn(users.id, []) // (1 = 1)
```

## Order and paginate

Wrap ordering terms in `orderBy()` and choose `fetchFirst()` or `offset()` for
pagination:

```ts
import { desc, fetchFirst, offset, orderBy } from 'qubu'

const page = select(
  { id: users.id, name: users.name },
  orderBy(desc(users.name)),
  offset(20),
  fetchFirst(20),
  where(eq(users.id, 7)),
  from(users)
)
```

The rendered clause order is still `FROM`, `WHERE`, `ORDER BY`, and pagination.
The active dialect decides whether pagination uses standard `FETCH` syntax or a
driver-specific `LIMIT` form.

## Group and aggregate

Object projection keys provide stable names for aggregates. Group every
non-aggregate column dependency:

```ts
import {
  count,
  desc,
  eq,
  from,
  groupBy,
  gt,
  having,
  leftJoin,
  orderBy,
  select,
} from 'qubu'

const counts = select(
  {
    name: users.name,
    postCount: count(posts.id),
  },
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  groupBy(users.name),
  having(gt(count(posts.id), 0)),
  orderBy(desc(count(posts.id)))
)
```

`users.name` is grouped, while `posts.id` is consumed by `COUNT()`. The same
dependency rule applies to `HAVING` and grouped `ORDER BY` expressions. A
projection such as `{ email: users.email, postCount: count(posts.id) }` is
rejected unless `users.email` is also grouped; Qubu does not infer functional
dependencies from database keys.

## Window functions

Use `over()` to attach an inline window specification to a typed expression.
The initial window scope supports `PARTITION BY` and `ORDER BY`; the same
`asc()` and `desc()` terms used by a query-level `orderBy()` can be reused:

```ts
import { desc, from, over, rowNumber, select } from 'qubu'

const rankedUsers = select(
  {
    id: users.id,
    rowNumber: over(rowNumber(), {
      partitionBy: [users.name],
      orderBy: [desc(users.id)],
    }),
  },
  from(users)
)
```

Window expressions remain ordinary expressions: they can be projected,
aliased, and passed to `orderBy()`. Their source requirements and result types
are retained through `over()`, and values rendered inside the window
specification remain parameters. Named windows and frame clauses are outside
the initial inline scope.

For CTEs, derived tables, scalar subqueries, and set operations, continue with
[Compose queries](compose-queries.md).
