# Getting started

> Define a typed table, build one parameterized query, and inspect the exact SQL before connecting a driver.

## Install Qubu

Add the package to a TypeScript project:

```bash
pnpm add qubu
```

Import query-building functions from the package root. Qubu does not need a
database connection to construct or render a query.

## Define a table

Use `table()` once for each query-facing table. Column helpers describe the
application values that can be selected and, for mutations, written.

```ts
import { integer, table, text } from 'qubu'

const users = table('users', {
  id: integer(),
  name: text(),
  email: text({ nullable: true }),
})
```

`users.id`, `users.name`, and `users.email` are typed column expressions. The
nullable email column is inferred as `string | null` when selected.

## Build and render a query

Pass a projection and independent clauses to `select()`. Clauses may be
written in the order that reads best; Qubu renders them in SQL order.
The example uses the `users` table from the previous section.

```ts
import { eq, from, render, select, where } from 'qubu'

const query = select(
  {
    id: users.id,
    displayName: users.name,
  },
  where(eq(users.id, 7)),
  from(users)
)

const statement = render(query)
```

The default dialect quotes identifiers with double quotes and uses `?` for
parameters:

```ts
statement.text
// SELECT "users"."id" AS "id", "users"."name" AS "displayName" FROM "users" WHERE ("users"."id" = ?)

statement.parameters
// [7]
```

The selected row type is available on the query value:

```ts
type UserRow = typeof query.row
// { id: number; displayName: string }
```

> [!NOTE]
> Rendering produces a statement; it does not execute it. Keep the
> `RenderedQuery` value for logging, testing, or passing to a
> [driver-owned adapter](concepts/dialects-and-execution.md).

## Next steps

- [Build a `SELECT`](guides/select.md) with joins, predicates, aggregates, and
  pagination.
- [Compose queries](guides/compose-queries.md) from CTEs and derived sources.
- [Write mutations](guides/mutations.md) with typed insert/update/delete
  inputs.
- [Choose a database dialect](concepts/dialects-and-execution.md) when the
  driver expects different identifier, placeholder, or pagination syntax.
- [Read JSON scalars](guides/json.md) from a JSON column.
- [Use the Vite compiler hint](guides/vite-plugin.md) for directive-based
  imports.
