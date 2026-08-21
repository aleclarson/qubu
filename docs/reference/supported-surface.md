# Supported features

> Choose a package entrypoint and see which work Qubu handles.

## Package entrypoints

| Import               | Use it for                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `qubu`               | Core fragments, schema helpers, expressions, `SELECT`, mutations, rendering, and execution adapters |
| `qubu/postgres`      | PostgreSQL dialect helpers such as `postgresDialect()` and `ilike()`                                |
| `qubu/sqlite`        | The SQLite dialect policy                                                                           |
| `qubu/mysql`         | The MySQL dialect policy                                                                            |
| `qubu/snapshot`      | Canonical schema v1 traversal, encoding, strict decoding, diagnostics, and content digests          |
| `qubu/introspection` | User-owned catalog readers and normalized catalog-to-Snapshot v1 mapping                            |
| `qubu/vite`          | The optional `qubu()` Vite compiler hint                                                            |
| `qubu/globals`       | Opt-in ambient declarations for directive-bearing modules                                           |

Dialect helpers are also re-exported from `qubu`, but subpath imports make the
database-specific dependency visible where that is useful.

The PostgreSQL snapshot adapter and its support limits are listed in the
[PostgreSQL snapshot matrix](postgres-snapshot.md).
The SQLite snapshot adapter and its support limits are listed in the
[SQLite snapshot matrix](sqlite-snapshot.md).
The MySQL snapshot adapter and its support limits are listed in the
[MySQL snapshot matrix](mysql-snapshot.md).

## Capability map

| Area               | Supported building blocks                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema values      | `table`, immutable `schema` registries with namespaces, portable and dialect-native column storage descriptors, canonical default and generated-column metadata, identity descriptors, named primary, candidate-key, nullable unique, foreign-key, and check constraints, physical object names, included-column indexes, typed dialect extensions, and typed column helpers |
| Read queries       | Named projections, spreadable source columns, aliases, joins, typed custom and LATERAL `FROM` sources, correlated subqueries, `WHERE`, grouping with declared-key proofs, `HAVING`, ordering, window expressions, distinctness, pagination, CTEs, subqueries, and set operations                                                                                             |
| Expressions        | Comparison, boolean, arithmetic, null, range, membership, aggregate, window, string, JSON scalar reads, definition-backed and raw cast, case, custom expressions, and branded deterministic schema expressions                                                                                                                                                               |
| SQL type metadata  | Portable domains and capabilities, physical column storage descriptors, `SqlTypeOf`, projected SQL type maps, `SourceLike`/`TableLike` field constraints, contextual literals, typed extension values/calls/casts, and permissive `SqlUnknown` fallback                                                                                                                      |
| Write queries      | `INSERT` values/defaults/select, `UPDATE`, `DELETE`, typed assignments, `RETURNING`, and explicit unrestricted-write opt-in                                                                                                                                                                                                                                                  |
| Rendering          | Standard, PostgreSQL, SQLite, MySQL, and user-created identifier, placeholder, pagination, JSON, logical cast-target, and schema-literal policies                                                                                                                                                                                                                            |
| Execution boundary | Generic `QueryAdapter` plus `execute()`; connection and driver behavior remain external                                                                                                                                                                                                                                                                                      |
| Build tooling      | Optional Vite directive transform with matching TypeScript ambient declarations, plus the opt-in `qubu/snapshot` canonical schema tooling entrypoint                                                                                                                                                                                                                         |
| Introspection      | Optional PostgreSQL, SQLite, and MySQL catalog readers for one selected namespace, structured diagnostics, and strict or explicit lossy Snapshot v1 mapping                                                                                                                                                                                                                  |

## Safety boundaries

Qubu binds values through the render context and quotes identifiers through the
active dialect. `UPDATE` and `DELETE` require a `WHERE` clause unless the caller
passes `allowAll()`.

Use raw syntax through explicit unsafe helpers. They are not a sanitizer and
do not make interpolated values safe. Use
`context.parameter()` in custom renderers and keep driver encoding in the
adapter.

SQL semantic types provide compile-time portable capability and compatibility
checks. They do not validate migrations, verify runtime schema state, or model
every dialect's implicit coercions. Database catalog reading is available
through the separate `qubu/introspection` entrypoint. Custom and untyped
extensions default to permissive `SqlUnknown`; use declared domains when an
extension should participate in stricter checks.

## Boundary

Qubu owns query construction, type propagation, SQL rendering, and optional
read-only catalog normalization. It does not own:

- database connections, pooling, retries, or transactions;
- driver-specific parameter encoding or row decoding;
- migrations, migration planning, DDL generation, or database lifecycle;
- DDL generation and dialect-specific index storage options;
- ORM identity maps, relationship loading, or change tracking; or
- hidden execution triggered by building a query value.

When you need one of those concerns, pass the rendered query through an
application-owned adapter or another library. Start with [Dialects and
execution](../dialects-and-execution.md).
