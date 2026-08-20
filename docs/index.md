# Qubu

> Build parameterized SQL from typed tables, expressions, and clauses.

Qubu builds SQL from values. Tables, expressions, clauses, and complete queries
compose without a mutable query builder. TypeScript tracks selected row shapes,
source scope, and nullability, while rendering returns SQL text and ordered
parameters.

## Start here

If this is your first query, follow [Getting started](getting-started.md) to
define a table, build a `SELECT`, and inspect its SQL and parameters.

Use the rest of the docs by task:

- [Build a `SELECT`](guides/select.md) with filters, joins, grouping, ordering,
  and pagination.
- [Compose queries](guides/compose-queries.md) with CTEs, derived tables,
  subqueries, and set operations.
- [Write mutations](guides/mutations.md) with typed `INSERT`, `UPDATE`, and
  `DELETE` statements.
- [Extend Qubu](guides/extensions.md) with a custom dialect policy, fragment,
  or clause when the built-in API is not enough.
- [Use dialects and adapters](concepts/dialects-and-execution.md) when SQL must
  match a particular driver or execution layer.
- [Serialize schema metadata](concepts/schema-snapshots.md) through the optional
  `qubu/snapshot` tooling entrypoint.
- [Read JSON scalars](guides/json.md) from structured JSON paths.
- [Enable the Vite compiler hint](guides/vite-plugin.md) when query modules
  should opt into named imports through a directive.

## The Qubu pipeline

The same query value can be rendered for inspection or passed to an adapter for
execution. The adapter, not the query builder, owns the database connection and
driver-specific row handling.

```mermaid
flowchart LR
  A["Tables and columns"] --> B["Expressions and clauses"]
  B --> C["Typed query"]
  C --> D["Dialect renderer"]
  D --> E["SQL text + ordered parameters"]
  E --> F["Driver-owned adapter"]
  F --> G["Application rows"]
```

Values become bound parameters, and the active dialect quotes identifiers. Raw
SQL is available through explicit unsafe helpers. The call site shows where
that unchecked syntax enters the query.

## A small example

```ts
import { eq, from, integer, render, select, table, text, where } from 'qubu'

const users = table('users', {
  id: integer(),
  name: text(),
})

const query = select(
  { id: users.id, name: users.name },
  from(users),
  where(eq(users.id, 7))
)

render(query)
// {
//   text: 'SELECT "users"."id" AS "id", "users"."name" AS "name" FROM "users" WHERE ("users"."id" = ?)',
//   parameters: [7],
// }
```

The inferred row is `{ id: number; name: string }`. The value `7` stays out of
the SQL text and appears in the `parameters` array in placeholder order.

## Choose the next concept

| If you need to decide...                                       | Read...                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Why a column can be rejected outside `FROM` or `JOIN` scope    | [Source scope](concepts/query-model/source-scope.md)                     |
| How a query changes across PostgreSQL, SQLite, or MySQL        | [Dialects and execution](concepts/dialects-and-execution.md)             |
| How nullability, defaults, and generated columns affect writes | [Column behavior and write types](concepts/schema/columns-and-writes.md) |
| Why equal JavaScript types can allow different SQL operations  | [SQL semantic types](concepts/sql-semantic-types.md)                     |
| Which package entrypoint or feature to use                     | [Supported features](reference/supported-surface.md)                     |
| What a failure means and what to verify                        | [Troubleshooting](troubleshooting.md)                                    |

Qubu builds and renders SQL; it does not provide an ORM, migrations, connection
pooling, transactions, or relationship loading. See the [supported
features](reference/supported-surface.md#boundary) for the full boundary.
