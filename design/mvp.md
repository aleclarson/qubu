# Qubu MVP scope

> Internal release boundary for the first Qubu release: a compact typed query builder with a complete render-to-adapter path.

## Included

- Parameterized, composable `SELECT` queries with named projections and
  spreadable source columns,
  joins, typed LATERAL sources, grouping, window expressions, ordering,
  pagination, row locking, CTEs, subqueries, set operations, and source-scope
  diagnostics.
- Standard SQL rendering plus explicit PostgreSQL, SQLite, and MySQL dialect
  policies for identifiers, placeholders, pagination, and row locking.
- Schema helpers for dates/timestamps, UUIDs, caller-typed JSON, bigint, and
  binary values.
- Typed `INSERT`, `UPDATE`, and `DELETE` statements with bound values,
  `DEFAULT VALUES`, multi-row values, `INSERT ... SELECT`, source-aware
  assignments and predicates, and reusable typed `RETURNING` projections.
- Null-safe equality and portable empty `IN`/`NOT IN` behavior.
- Parameterized SQL templates whose static text is trusted syntax, whose
  ordinary substitutions become parameters, and whose fragment substitutions
  retain renderer metadata.
- A driver-neutral adapter boundary with structured execution results, an
  opt-in transaction-scoped client, and an opt-in Vite compiler hint.
- Pure snapshot serialization, snapshot diffing, migration planning, and DDL
  emission, plus catalog introspection through an application-owned connection
  interface.

## Rendering and execution boundary

```mermaid
flowchart LR
  A[Typed query functions] --> B[Composable fragments]
  B --> C[Dialect renderer]
  C --> D[SQL text plus ordered values]
  D --> E[Application-owned adapter]
  E --> F[Rows plus optional mutation facts]
```

The compile-time parameter contract is a union of accepted value types. Runtime
rendering owns the order of `RenderedQuery.parameters`, which follows the
placeholders in `RenderedQuery.text`. `execute()` passes that statement, the
query kind, and an optional abort signal to `QueryAdapter`, then returns its
`ExecutionResult`. `executeRows()` returns only its typed rows.

## Safety defaults

Values are bound parameters and identifiers are quoted through the dialect.
`UPDATE` and `DELETE` require a `WHERE` clause unless the caller explicitly
passes `allowAll()`. The `sql` tag accepts trusted static template text, binds
ordinary substitutions, and composes fragment substitutions. Dynamic syntax
remains behind explicit unsafe primitives. Adapter errors pass through
unchanged.

## Deferred

- Dialect-aware `ON CONFLICT` upsert support.
- Recursive CTEs, `JOIN ... USING`, `EXPLAIN`, and broader vendor-specific
  syntax.
- Migration execution, ORM behavior, relationship loading, connection
  lifecycle, and driver-specific transaction configuration.
