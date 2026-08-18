# Supported surface

> Use this page to choose the public package entrypoint and understand where Qubu's responsibilities stop.

## Package entrypoints

| Import          | Use it for                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `qubu`          | Core fragments, schema helpers, expressions, `SELECT`, mutations, rendering, and execution adapters |
| `qubu/postgres` | PostgreSQL dialect helpers such as `postgresDialect()` and `ilike()`                                |
| `qubu/sqlite`   | The SQLite dialect policy                                                                           |
| `qubu/mysql`    | The MySQL dialect policy                                                                            |
| `qubu/vite`     | The optional `qubu()` Vite compiler hint                                                            |
| `qubu/globals`  | Opt-in ambient declarations for directive-bearing modules                                           |

Dialect helpers are also re-exported from `qubu`, but subpath imports make the
database-specific dependency visible where that is useful.

## Capability map

| Area               | Supported building blocks                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema values      | `table`, `column`, `integer`, `numeric`, `text`, `boolean`, date/time, UUID, JSON, bigint, and binary helpers                                                                                                                     |
| Read queries       | Projections, wildcards, aliases, joins, typed custom and LATERAL `FROM` sources, correlated subqueries, `WHERE`, grouping, `HAVING`, ordering, window expressions, distinctness, pagination, CTEs, subqueries, and set operations |
| Expressions        | Comparison, boolean, arithmetic, null, range, membership, aggregate, window, string, cast, case, and custom expressions                                                                                                           |
| Write queries      | `INSERT` values/defaults/select, `UPDATE`, `DELETE`, typed assignments, `RETURNING`, and explicit unrestricted-write opt-in                                                                                                       |
| Rendering          | Standard, PostgreSQL, SQLite, MySQL, and user-created dialect policies                                                                                                                                                            |
| Execution boundary | Generic `QueryAdapter` plus `execute()`; connection and driver behavior remain external                                                                                                                                           |
| Build tooling      | Optional Vite directive transform with matching TypeScript ambient declarations                                                                                                                                                   |

## Safety boundaries

Qubu binds values through the render context and quotes identifiers through the
active dialect. `UPDATE` and `DELETE` require a `WHERE` clause unless the caller
passes `allowAll()`.

Raw syntax is available through explicit unsafe primitives. Those primitives
are not a sanitizer and do not make interpolated values safe. Use
`context.parameter()` in custom renderers and keep driver encoding in the
adapter.

## Boundary

Qubu owns query construction, type propagation, and SQL rendering. It does not
own:

- database connections, pooling, retries, or transactions;
- driver-specific parameter encoding or row decoding;
- schema introspection, migrations, or database lifecycle;
- ORM identity maps, relationship loading, or change tracking; or
- hidden execution triggered by building a query value.

When you need one of those concerns, pass the rendered query through an
application-owned adapter or another library. Start with [Dialects and
execution](../concepts/dialects-and-execution.md).
