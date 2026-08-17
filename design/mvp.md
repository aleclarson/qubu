# Qubu MVP scope

> Internal release boundary for the first Qubu release: a compact typed query builder with a complete render-to-adapter path.

## Included

- Parameterized, composable `SELECT` queries with projections, wildcards,
  joins, grouping, ordering, CTEs, subqueries, set operations, and source-scope
  diagnostics.
- Standard SQL rendering plus explicit PostgreSQL, SQLite, and MySQL dialect
  policies for identifiers, placeholders, and pagination.
- Schema helpers for dates/timestamps, UUIDs, caller-typed JSON, bigint, and
  binary values.
- Typed `INSERT`, `UPDATE`, and `DELETE` statements with bound values,
  `DEFAULT VALUES`, multi-row values, `INSERT ... SELECT`, source-aware
  assignments and predicates, and reusable typed `RETURNING` projections.
- Null-safe equality and portable empty `IN`/`NOT IN` behavior.
- A driver-neutral adapter boundary and an opt-in Vite compiler hint.

## Rendering and execution boundary

```mermaid
flowchart LR
  A[Typed query functions] --> B[Composable fragments]
  B --> C[Dialect renderer]
  C --> D[SQL text plus ordered values]
  D --> E[Driver-owned adapter]
  E --> F[Typed application rows]
```

The compile-time parameter contract is a union of accepted value types. Runtime
rendering owns the order of `RenderedQuery.parameters`, which follows the
placeholders in `RenderedQuery.text`.

## Safety defaults

Values are bound parameters and identifiers are quoted through the dialect.
`UPDATE` and `DELETE` require a `WHERE` clause unless the caller explicitly
passes `allowAll()`. Raw SQL remains available only through explicit unsafe
primitives. Adapter errors are not caught or rewritten by the core.

## Deferred

- Dialect-aware `ON CONFLICT` upsert support.
- Recursive CTEs, `JOIN ... USING`, and lateral joins.
- Typed window-function composition and broader vendor-specific syntax.
- Schema introspection, migrations, ORM behavior, relationship loading,
  connection lifecycle, and transaction orchestration.
