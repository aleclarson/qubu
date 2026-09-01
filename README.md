# Qubu

> Build parameterized SQL from simple type declarations and composable values.

Qubu is a functional-first, type-aware SQL builder for TypeScript. Define
tables once, combine expressions and clauses as ordinary values, and inspect
the exact SQL and parameters before execution.

Qubu stays close to SQL rather than replacing it with an object model. The type
system tracks the facts needed to compose a query safely, while the rendered
statement remains recognizable to anyone who knows SQL.

> [!IMPORTANT]
> Qubu is pre-alpha. Its public APIs and package structure may change between
> releases.

## A small query

Declare a table, build a reusable condition, and pass it into a query:

```ts
import { eq, from, integer, render, select, table, text, where } from "qubu"

const users = table("users", {
  id: integer(),
  name: text(),
})

const byId = where(eq(users.id, 7))

const query = select(
  {
    id: users.id,
    name: users.name,
  },
  from(users),
  byId,
)

type UserRow = typeof query.row
// { id: number; name: string }

render(query)
// {
//   text: 'SELECT "users"."id" AS "id", "users"."name" AS "name" FROM "users" WHERE ("users"."id" = ?)',
//   parameters: [7],
// }
```

The table declaration supplies the application types, the condition remains a
value that can be reused, and `7` becomes a bound parameter instead of SQL
text. The projection determines the inferred result row.

Clauses are independent values. `select()` accepts them in any argument order
and renders them in canonical SQL order. Writing the final call in SQL order is
still the preferred style because it is easier to scan.

## Designed to be understood

Qubu favors small declarations and functions that return composable values. A
query can be assembled or changed one piece at a time, and TypeScript reports
when those pieces do not fit. Rendering provides the SQL and parameters needed
to check the result directly.

These properties also help coding agents. A table declaration gives an agent a
compact description of the data, composable values keep changes local, and the
type checker and rendered SQL provide concrete feedback. That reduces guessing
and makes the resulting work easier for a person to review.

Qubu ships [version-matched documentation](docs/index.md) and a
[Qubu skill](skills/qubu/SKILL.md) that routes agent tasks to the relevant
guide for the installed package.

## Scope and boundaries

Qubu is for developers who know SQL and want composition and type checking
without adopting an ORM model. It does not provide relationship loading,
identity maps, lazy loading, or change tracking.

Qubu constructs and renders queries, and it can pass them through an
application-supplied adapter. The application continues to own its database
driver, connections, and database lifecycle. PostgreSQL, SQLite, and MySQL
differences remain visible through explicit dialect entrypoints.

Optional entrypoints and workspace packages cover schema introspection, source
generation, snapshots, diffs, migration planning, DDL emission, and migration
operations. These stages remain separate so applications can inspect and
approve a change before executing it. See [Supported features](docs/reference/supported-surface.md)
for the complete package and ownership map.

## Start here

Install Qubu in a TypeScript project:

```bash
pnpm add qubu
```

Continue with the documentation for the task at hand:

- [Getting started](docs/getting-started.md) defines a table and renders the
  first query.
- [Build a `SELECT`](docs/guides/select/overview.md) covers projections,
  predicates, joins, grouping, and pagination.
- [Write mutations](docs/guides/mutations.md) covers typed `INSERT`, `UPDATE`,
  and `DELETE` statements.
- [Dialects and execution](docs/dialects-and-execution.md) explains rendering
  policies and the application-owned adapter boundary.
- [Schema and migration documentation](docs/schema/tables-and-names.md) starts
  with table metadata and links through snapshots, diffs, plans, and DDL.
- [Troubleshooting](docs/troubleshooting.md) starts from common query failures
  and their repair paths.
