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

An object projection uses its keys as result names. You can also pass a single
column, an array of columns or aliased expressions, or a wildcard:

```ts
import { aliasExpression, all, count } from 'qubu'

select(all(users), from(users))

select([users.name, aliasExpression(count(users.id), 'userCount')], from(users))
```

The object form is the clearest choice when the result is consumed by
application code because the row shape is written at the selection site.

## Add joins and predicates

Join functions add a source and make the join condition part of the same scope
check as the projection and `WHERE` clause:

```ts
import { aliasExpression, count, innerJoin, isNotNull, leftJoin } from 'qubu'

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
    postCount: aliasExpression(count(posts.id), 'postCount'),
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

Aggregates are expressions, so alias them when the result needs a stable field
name and group the non-aggregate expressions:

```ts
import { aliasExpression, count, desc, groupBy, leftJoin, orderBy } from 'qubu'

const counts = select(
  [users.name, aliasExpression(count(posts.id), 'postCount')],
  from(users),
  leftJoin(posts, eq(users.id, posts.authorId)),
  groupBy(users.name),
  orderBy(desc(count(posts.id)))
)
```

For CTEs, derived tables, scalar subqueries, and set operations, continue with
[Compose queries](compose-queries.md).
