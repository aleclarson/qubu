# Compose queries

> Reuse a query's inferred row shape as a typed source for CTEs, derived tables, subqueries, and set operations.

## Turn a query into a CTE

`cte()` exposes the selected fields of a query as columns on a new source.
Attach it with `withCte()` and use the CTE source in `from()`:

```ts
import {
  cte,
  eq,
  from,
  integer,
  select,
  table,
  text,
  where,
  withCte,
} from 'qubu'

const users = table('users', {
  id: integer(),
  name: text(),
})

const activeUsers = cte(
  'active_users',
  select(
    { id: users.id, name: users.name },
    from(users),
    where(eq(users.id, 7))
  )
)

const report = select(
  { displayName: activeUsers.name },
  withCte(activeUsers),
  from(activeUsers)
)
```

`activeUsers.name` is a typed column derived from the first query's row shape.
The rendered statement includes the `WITH` clause before `SELECT`.

## Use a derived table

Alias a query when it should be used as an inline source:

```ts
import { alias, from, select } from 'qubu'

const names = select({ name: users.name }, from(users))
const namesSource = alias(names, 'names')

const query = select({ name: namesSource.name }, from(namesSource))
```

The alias gets the selected query's fields, while the new source identity keeps
scope checks from confusing `namesSource.name` with `users.name`.

## Nest a scalar subquery

`scalar()` turns a query with exactly one selected field into an expression:

```ts
import { scalar, value } from 'qubu'

const firstId = select({ id: users.id }, from(users))
const query = select(
  {
    name: users.name,
    firstId: scalar(firstId),
  },
  from(users)
)
```

`scalar()` throws at runtime when the query selects more than one field. Its
type is the selected field's value type, widened with `null` when the query may
return no rows. An ordinary select and `fetchFirst(1)` are both nullable: the
limit proves at most one row, not that a row exists. A source-free select such
as `select({ value: value(42) })` is known to produce exactly one row.

Qubu does not treat an arbitrary predicate as proof of exactness. Use
`exists()`, `notExists()`, or `inQuery()` for boolean subquery predicates.

## Combine compatible queries

Set operations preserve the left query's row shape. Both queries must select
compatible rows:

```ts
import { unionAll } from 'qubu'

const first = select({ id: users.id }, from(users))
const second = select({ id: users.id }, from(users), where(eq(users.id, 7)))

const allUsers = unionAll(first, second)
```

Use `union`, `unionAll`, `intersect`, or `except` depending on the SQL
operation. Each input renderer still contributes its runtime parameters, which
are collected in traversal order.

## Prefer values over a builder chain

Build reusable pieces as ordinary values and pass them into the final query:

```ts
import { desc, eq, orderBy, where } from 'qubu'

const byId = where(eq(users.id, 7))
const newest = orderBy(desc(users.id))

const query = select(
  { id: users.id, name: users.name },
  newest,
  byId,
  from(users)
)
```

This makes it possible to share a predicate or projection without mutating a
query object. The final `select()` call remains the place where source scope
and result shape are checked.
