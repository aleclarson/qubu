# Order and paginate

> Choose a stable order and apply optional row limits while keeping SQL clause order and query cardinality visible.

The examples use the `users` table from [Build a `SELECT`](overview.md).

## Order rows

Wrap ordering terms in `orderBy()`:

```ts
import { desc, from, orderBy, select } from 'qubu'

const ordered = select(
  { id: users.id, name: users.name },
  from(users),
  orderBy(desc(users.name))
)
```

Use `asc()` or `desc()` for each term. The selected dialect controls the
identifier quoting and any dialect-specific ordering syntax.

## Paginate results

Choose `fetchFirst()` or `offset()` for pagination:

```ts
import {
  desc,
  eq,
  fetchFirst,
  from,
  offset,
  orderBy,
  select,
  where,
} from 'qubu'

const page = select(
  { id: users.id, name: users.name },
  orderBy(desc(users.name)),
  offset(20),
  fetchFirst(20),
  where(eq(users.id, 7)),
  from(users)
)
```

The rendered clause order is still `FROM`, `WHERE`, `ORDER BY`, and
pagination. The active dialect decides whether pagination uses standard
`FETCH` syntax or a driver-specific `LIMIT` form.

Pair a pagination clause with `omit` when the row bound is optional at runtime:

```ts
import { fetchFirst, omit } from 'qubu'

declare const pageSize: number | undefined

const page = select(
  { id: users.id, name: users.name },
  from(users),
  pageSize === undefined ? omit : fetchFirst(pageSize)
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
