# Build a `SELECT`

> Build a `SELECT` from typed tables, then inspect its sources, projection, joins, and result row.

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

An object projection uses its keys as result names. Name the fields you intend
to return in the usual case. Reserve `all(source)` for a result contract that
intentionally returns every source column. It returns the source's columns as a
named projection object, so it can still be spread alongside computed
expressions:

```ts
import { all, from, select, upper } from 'qubu'

const query = select(
  { ...all(users), normalizedName: upper(users.name) },
  from(users)
)
```

`all(source)` expands to explicit named columns rather than emitting
`source.*`. That keeps the SQL output and the inferred row keys aligned.

Named object projections keep the row shape visible at the selection site,
which is useful when the result is consumed by application code.

## Add joins and predicates

Join functions add a source and make the join condition part of the same scope
check as the projection and `WHERE` clause:

```ts
import {
  count,
  eq,
  from,
  innerJoin,
  isNotNull,
  leftJoin,
  select,
  table,
  text,
  integer,
  where,
} from 'qubu'

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

Use `innerJoin`, `leftJoin`, `rightJoin`, or `fullJoin` with an `ON`
condition. `crossJoin` and `naturalJoin` add a source without a condition;
use them only when that SQL behavior is intentional.

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

## Read next

- [Add optional conditions](conditions.md) covers conditional clauses, null
  checks, and empty membership lists.
- [Order and paginate](ordering-and-pagination.md) covers stable ordering and
  optional row limits.
- [Group and rank rows](grouping-and-windows.md) covers aggregates and window
  expressions.
- [Source scope](../../query-model/source-scope.md) explains why each column
  must come from a source in the query.
- [Result shapes and cardinality](../../query-model/result-shapes.md) explains
  how joins and nested queries affect row types.
