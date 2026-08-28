# Add optional conditions

> Keep optional predicates, null checks, and empty-list behavior explicit while
> the query keeps the same structural shape.

The examples use the `users` table from [Build a `SELECT`](overview.md).

## Omit query parts conditionally

Use `omit` as the other branch of a JavaScript conditional when a `WHERE`,
`HAVING`, `ORDER BY`, or `DISTINCT` clause is optional:

```ts
import { eq, from, omit, select, where } from "qubu"

declare const userId: number | undefined

const query = select(
  { id: users.id, name: users.name },
  from(users),
  userId === undefined ? omit : where(eq(users.id, userId)),
)
```

The ordinary ternary narrows `userId`, and the unused clause is never built.
Qubu removes `omit` before validating and ordering the remaining clauses.

Use the same token inside `and()`, `or()`, and `orderBy()` when individual
predicates or ordering terms are conditional:

```ts
import { and, desc, eq, omit, orderBy, where } from "qubu"

declare const includeName: boolean
declare const newestFirst: boolean

const filter = where(and(eq(users.id, 7), includeName ? eq(users.name, "Ada") : omit))
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
  from(users),
)

// typeof query.row:
// { id: number; email?: string | null }
```

Here `omit` affects only whether `email` belongs to the projection. It does
not make the expression nullable: a non-nullable expression would produce
`email?: string`, while this nullable column produces `email?: string | null`.

This support is specific to boolean operand lists, query-level ordering terms,
and the complete clauses named above. Generic `sequence()` and
`commaSeparated()` collections do not discard `omit`. Clauses that provide
sources or change structural guarantees cannot be conditional. Pagination is
the exception: `offset()`, `fetchFirst()`, and `fetchNext()` can be paired
with `omit`, but a conditional row bound keeps the query's inferred
cardinality at `many`. Qubu still rejects `omit` branches paired with
`from()`, joins, `groupBy()`, correlation, CTEs, or custom clauses. Build
separate queries when those structural parts differ at runtime.

## Handle `NULL` and empty lists deliberately

Equality with `null` is translated to the SQL null predicate:

```ts
import { eq, isDistinctFrom, ne } from "qubu"

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

## Read next

- [Order and paginate](ordering-and-pagination.md) covers stable ordering and
  optional row limits.
- [Group and rank rows](grouping-and-windows.md) covers aggregates and window
  expressions.
- [Source scope](../../query-model/source-scope.md) explains why a column is
  valid only after its source enters the query.
