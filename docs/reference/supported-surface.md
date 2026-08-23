# Supported features

> Choose a public package entrypoint, check what Qubu handles, and keep database work on the application side of each adapter.

## Package entrypoints

| Import                  | Kind             | Use it for                                                                                               |
| ----------------------- | ---------------- | -------------------------------------------------------------------------------------------------------- |
| `qubu`                  | Runtime          | Ordinary query and schema definitions, reads, writes, SQL templates, rendering, and execution contracts  |
| `qubu/core`             | Runtime          | Fragment and rendering primitives, dialect construction, SQL types, and extension constructors           |
| `qubu/codegen`          | Runtime          | Deterministic machine-owned TypeScript schemas from complete, non-lossy introspection                    |
| `qubu/ddl`              | Runtime          | DDL preflight and deterministic PostgreSQL, SQLite, or MySQL emission from a migration plan              |
| `qubu/diff`             | Runtime          | Canonical Snapshot v1 or v2 comparison, rename hints, suggestions, and safety diagnostics                |
| `qubu/drizzle`          | Runtime          | Shared Drizzle conversion errors and dialect types                                                       |
| `qubu/introspection`    | Runtime          | Catalog readers, normalized catalogs, and mapping to Snapshot v1 or v2                                   |
| `qubu/migration`        | Runtime          | Pure migration planning with dependencies, decisions, preconditions, and explicit custom SQL             |
| `qubu/mysql`            | Runtime          | The MySQL query dialect policy                                                                           |
| `qubu/postgres`         | Runtime          | PostgreSQL query dialect helpers such as `postgresDialect()` and `ilike()`                               |
| `qubu/schema`           | Runtime          | Advanced schema metadata, storage and constraint models, source models, and schema-expression extensions |
| `qubu/snapshot`         | Runtime          | Canonical Snapshot v1 and v2 traversal, encoding, decoding, diagnostics, and digests                     |
| `qubu/sqlite`           | Runtime          | The SQLite query dialect policy                                                                          |
| `qubu/vite`             | Runtime          | The optional `qubu()` Vite compiler hint                                                                 |
| `qubu/package.json`     | JSON             | The published package manifest                                                                           |
| `qubu/drizzle/mysql`    | Runtime          | Runtime conversion from Qubu schemas to MySQL Drizzle tables                                             |
| `qubu/drizzle/postgres` | Runtime          | Runtime conversion from Qubu schemas to PostgreSQL Drizzle tables                                        |
| `qubu/drizzle/sqlite`   | Runtime          | Runtime conversion from Qubu schemas to SQLite Drizzle tables                                            |
| `qubu/globals`          | TypeScript types | Opt-in ambient declarations for directive-bearing modules                                                |

The package validator confirms 17 runtime entrypoints, 18 type entrypoints,
`qubu/package.json` as JSON, and `qubu/globals` as type-only. Concrete dialect
constructors live on their database subpaths. The root renderer uses Qubu's
standard SQL policy by default.

Snapshot dialect behavior is documented in the [PostgreSQL](postgres-snapshot.md),
[SQLite](sqlite-snapshot.md), and [MySQL](mysql-snapshot.md) support matrices.

## Canonical query vocabulary

Use the root names in new query code: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`,
`avg`, `min`, `max`, `fetchFirst`, `alias`, `render`, `qubu`, `execute`,
`deleteFrom`, and `allowAll`. The package does not document competing aliases
for these operations. Keep advanced fragment, dialect-construction, and
schema-extension imports on `qubu/core` or `qubu/schema` as shown in the
entrypoint table.

## Capability map

| Area               | Supported building blocks                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema values      | `table`, immutable `schema` registries with namespaces, portable and dialect-native column storage descriptors, canonical default and generated-column metadata, identity descriptors, named primary, candidate-key, nullable unique, foreign-key, and check constraints, physical object names, included-column indexes, typed dialect extensions, and typed column helpers |
| Read queries       | Named projections, spreadable source columns, aliases, joins, typed custom and LATERAL `FROM` sources, correlated subqueries, `WHERE`, grouping with declared-key proofs, `HAVING`, ordering, window expressions, distinctness, pagination, CTEs, subqueries, and set operations                                                                                             |
| Expressions        | Comparison, boolean, arithmetic, null, range, membership, aggregate, window, string, JSON scalar reads, definition-backed and raw casts, cases, parameterized SQL templates, custom expressions, and branded deterministic schema expressions                                                                                                                                |
| SQL type metadata  | Portable domains and capabilities, physical column storage descriptors, `SqlTypeOf`, projected SQL type maps, `SourceLike` and `TableLike` field constraints, contextual literals, typed extension values, calls, and casts, plus a permissive `SqlUnknown` fallback                                                                                                         |
| Write queries      | `INSERT` values, defaults, and selects; `UPDATE`; `DELETE`; typed assignments; `RETURNING`; and explicit unrestricted-write opt-in                                                                                                                                                                                                                                           |
| Rendering          | Standard, PostgreSQL, SQLite, MySQL, and user-created policies for identifiers, placeholders, pagination, JSON, logical cast targets, and schema literals                                                                                                                                                                                                                    |
| Execution boundary | `QueryAdapter`, opt-in `TransactionalQueryAdapter`, bound `QubuClient` and `QubuTransactionalClient` values from `qubu()`, structured results from `execute()` or `db.execute()`, and row-only results from `executeRows()` or `db.rows()`                                                                                                                                   |
| Snapshots          | Pure Snapshot v1 and v2 creation, canonical encoding and strict decoding, immutable data, diagnostics, and content digests                                                                                                                                                                                                                                                   |
| Introspection      | PostgreSQL, SQLite, and MySQL catalog readers for one selected namespace, normalized catalog data, structured diagnostics, and strict or explicit lossy snapshot mapping                                                                                                                                                                                                     |
| Snapshot diffing   | Pure Snapshot v1 and v2 comparison, explicit rename evidence, non-authoritative suggestions, and safety diagnostics                                                                                                                                                                                                                                                          |
| Migration planning | Pure, dialect-neutral plans with stable ordering, dependency edges, preconditions, explicit review decisions, and tagged custom SQL                                                                                                                                                                                                                                          |
| DDL emission       | Preflight plus deterministic PostgreSQL, SQLite, and MySQL statements from an approved `MigrationPlan` and matching `SchemaDialect`                                                                                                                                                                                                                                          |
| Build tooling      | The optional Vite directive transform and its matching TypeScript ambient declarations                                                                                                                                                                                                                                                                                       |
| Drizzle conversion | Optional, dialect-specific runtime conversion from Qubu schema registries to Drizzle tables                                                                                                                                                                                                                                                                                  |
| Source generation  | Pure Snapshot v1 table source printing, deterministic camelCase IDs, exact physical metadata, controlled type mappings, and structured failure diagnostics                                                                                                                                                                                                                   |

## Ownership boundary

Snapshot creation, diffing, migration planning, and DDL emission are pure.
`execute()`, clients, and catalog readers can reach a driver only through
interfaces the application provides. Qubu can emit DDL, but it never applies
that DDL to a database.

| Boundary                 | Qubu side                                                                                                                                                                                                  | Application side                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Query rendering          | Builds a typed query and renders SQL text with ordered raw parameter values                                                                                                                                | Keeps the runtime database schema aligned with query definitions and validates any dynamic syntax passed to an unsafe helper                                                                                    |
| Query execution          | Binds an adapter with `qubu()` when requested; renders and passes statements to `QueryAdapter`; scopes `db.transaction()` callbacks through `TransactionalQueryAdapter`; returns `ExecutionResult` or rows | Owns the adapter, driver, connections, pools, transaction begin/commit/rollback, savepoints, retries, parameter encoding, row decoding, cancellation behavior, driver error translation, and database lifecycle |
| Catalog introspection    | Selects fixed parameterized catalog queries, normalizes rows, and maps catalog data to snapshots                                                                                                           | Supplies `CatalogConnection`, credentials, already-decoded catalog rows, logging, and connection lifecycle                                                                                                      |
| Schema source generation | Prints deterministic TypeScript from complete, non-lossy Snapshot v1 introspection without writing files                                                                                                   | Owns generated-file writes, replacement policy, hand-edit merging, and CLI integration                                                                                                                          |
| Schema changes           | Creates snapshots, compares them, builds deterministic migration plans, and emits DDL from approved plans with preflight diagnostics                                                                       | Reviews decisions, executes or rolls back statements, acquires locks, manages transactions and migration journals, and owns database lifecycle                                                                  |

Start with [Dialects and execution](../dialects-and-execution.md) for the query
adapter contract. The schema path is documented in [Canonical schema
snapshots](../schema/snapshots.md), [Snapshot diffing](../schema/diff.md),
[Migration plans](../schema/migration-plans.md), and [DDL
emission](../schema/ddl-emission.md).

## SQL safety boundaries

Qubu binds values through the render context and quotes identifiers through the
active dialect. `UPDATE` and `DELETE` require a `WHERE` clause unless the caller
passes `allowAll()`.

The `sql` tag treats static template text as trusted SQL syntax. Ordinary
substitutions become parameters, and fragment substitutions compose through the
active renderer. Dynamic identifiers and syntax remain explicit through
`identifier()` and unsafe helpers. Those helpers are not sanitizers. Validate
dynamic syntax against an application-owned allowlist before it reaches an
unsafe helper.

SQL semantic types provide compile-time portable capability and compatibility
checks. They do not prove the runtime schema state or model every dialect's
implicit coercions. Custom and untyped extensions default to permissive
`SqlUnknown`; declare a domain when an extension should participate in stricter
checks.
