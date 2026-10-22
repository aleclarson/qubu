# Order and paginate

> Sort results and limit the rows a query returns.

The examples use the `users` table from [Build a `SELECT`](overview.md).

## Order rows

Wrap ordering terms in `orderBy()`:

```ts
import { desc, from, orderBy, select } from "qubu"

const ordered = select({ id: users.id, name: users.name }, from(users), orderBy(desc(users.name)))
```

Use `asc()` or `desc()` for each term. The selected dialect controls the
identifier quoting and any dialect-specific ordering syntax.

## Paginate results

Combine `fetchFirst()` with `offset()` for pagination. Include a unique
tie-breaker for stable pages:

```ts
import { desc, fetchFirst, from, offset, orderBy, select } from "qubu"

const page = select(
  { id: users.id, name: users.name },
  from(users),
  orderBy(desc(users.name), desc(users.id)),
  offset(20),
  fetchFirst(20),
)
```

The active dialect decides whether pagination uses standard `FETCH` syntax or
a `LIMIT` form. `fetchNext()` has the same row-bound behavior as `fetchFirst()`;
its distinction is the standard SQL keyword. All row counts must be
non-negative integers, including zero.

### Make the limit optional

Pair a pagination clause with `omit` when the row bound is optional at runtime:

```ts
import { fetchFirst, omit } from "qubu"

declare const pageSize: number | undefined

const page = select(
  { id: users.id, name: users.name },
  from(users),
  pageSize === undefined ? omit : fetchFirst(pageSize),
)
```

When `pageSize` is undefined, the query emits no pagination. Because the row
bound may be absent, conditional pagination does not narrow the query's
cardinality. An unconditional `fetchFirst(1)` retains its existing
`zero-or-one` inference.

## Read next

- [Add optional conditions](conditions.md) covers conditional clauses and
  null-aware predicates.
- [Group and rank rows](grouping-and-windows.md) covers aggregates and window
  expressions.
