# Supported features

> Choose a public package entrypoint and keep application policy separate from portable migration and driver-owned capabilities.

## Package entrypoints

| Import                     | Kind             | Use it for                                                                                                       |
| -------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `qubu`                     | Runtime          | Ordinary query and schema definitions, reads, writes, SQL templates, rendering, EXPLAIN, and execution contracts |
| `qubu/core`                | Runtime          | Fragment and rendering primitives, dialect construction, SQL types, and extension constructors                   |
| `qubu/codegen`             | Runtime          | Deterministic machine-owned TypeScript schemas from complete, non-lossy introspection                            |
| `qubu/diff`                | Runtime          | Canonical Snapshot v1 or v2 comparison, rename hints, suggestions, and safety diagnostics                        |
| `qubu/introspection`       | Runtime          | Catalog readers, normalized catalogs, and mapping to Snapshot v1 or v2                                           |
| `qubu/mysql`               | Runtime          | The MySQL query dialect policy                                                                                   |
| `qubu/postgres`            | Runtime          | PostgreSQL query dialect helpers such as `postgresDialect()` and `ilike()`                                       |
| `qubu/schema`              | Runtime          | Advanced schema metadata, storage and constraint models, source models, and schema-expression extensions         |
| `qubu/snapshot`            | Runtime          | Canonical Snapshot v1 and v2 traversal, encoding, decoding, diagnostics, and fingerprints                        |
| `qubu/sqlite`              | Runtime          | The SQLite query dialect policy and native SQLite column factories                                               |
| `qubu/vite`                | Runtime          | The optional `qubu()` Vite compiler hint                                                                         |
| `qubu/package.json`        | JSON             | The published package manifest                                                                                   |
| `@qubu/migrate`            | Runtime          | Migration compiler format identity and shared plan types                                                         |
| `@qubu/migrate/plan`       | Runtime          | Pure migration planning with dependencies, decisions, preconditions, and explicit custom SQL                     |
| `@qubu/migrate/ddl`        | Runtime          | DDL preflight and deterministic PostgreSQL, SQLite, or MySQL emission from a migration plan                      |
| `@qubu/migrate/artifact`   | Runtime          | Versioned programs, strict artifacts and baselines, canonical encoding, and SHA-256 integrity                    |
| `@qubu/migrate/repository` | Runtime          | Strict full-chain and journal-prefix verification                                                                |
| `@qubu/migrate/journal`    | Runtime          | Storage-neutral journal records, transitions, validation, and reference storage                                  |
| `@qubu/migrate/executor`   | Runtime          | Portable execution, structured errors, checkpointing, and explicit reconciliation                                |
| `@qubu/migrate/baseline`   | Runtime          | Strict live baseline verification and physical managed-schema comparison                                         |
| `@qubu/migrate/status`     | Runtime          | Pending chain, managed drift, unmanaged objects, interrupted attempts, and incompatible requirements             |
| `@qubu/migrate/bootstrap`  | Runtime          | Fresh SQLite schema planning through the normal diff, plan, and program compiler                                 |
| `@qubu/migrate/testing`    | Runtime          | Deterministic fake adapters, fault boundaries, and adapter conformance checks                                    |
| `@qubu/cli`                | Runtime and CLI  | `@alloc/cmd-ts` commands, typed config, filesystem repositories, stable output, and exit codes                   |
| `@qubu/drizzle`            | Runtime          | Shared Drizzle conversion errors and dialect types                                                               |
| `@qubu/drizzle/mysql`      | Runtime          | Runtime conversion from Qubu schemas to MySQL Drizzle tables                                                     |
| `@qubu/drizzle/postgres`   | Runtime          | Runtime conversion from Qubu schemas to PostgreSQL Drizzle tables                                                |
| `@qubu/drizzle/sqlite`     | Runtime          | Runtime conversion from Qubu schemas to SQLite Drizzle tables                                                    |
| `@qubu/better-auth`        | Runtime          | Better Auth schema derivation and native PostgreSQL, MySQL, and SQLite adapter behavior                          |
| `@qubu/adapter-neon`       | Runtime          | Experimental Neon HTTP PostgreSQL `QueryAdapter` behavior                                                       |
| `@qubu/adapter-planetscale` | Runtime          | Experimental PlanetScale serverless MySQL `QueryAdapter` and transaction behavior                              |
| `@qubu/adapter-aws-rds-data-api` | Runtime     | Experimental Aurora PostgreSQL/MySQL AWS RDS Data API adapter behavior                                         |
| `@qubu/adapter-sqlite-wasm` | Runtime          | Official SQLite WASM OO1 `QueryAdapter` for browser and web-worker databases                                     |
| `qubu/globals`             | TypeScript types | Opt-in ambient declarations for directive-bearing modules                                                        |

The package validator checks every declared entrypoint in each packed workspace
package. Concrete dialect constructors live on their database subpaths. The
root renderer uses Qubu's standard SQL policy by default.

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

| Area                 | Supported building blocks                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema values        | `table`, immutable `schema` registries with namespaces, portable and dialect-native column storage descriptors, canonical default and generated-column metadata, identity descriptors, named primary, candidate-key, nullable unique, foreign-key, and check constraints, physical object names, included-column indexes, typed dialect extensions, and typed column helpers             |
| Read queries         | Named projections, spreadable source columns, aliases, joins, typed custom and LATERAL `FROM` sources, correlated subqueries, `WHERE`, grouping with declared-key proofs, `HAVING`, ordering, window expressions, distinctness, pagination, row locking, ordinary and recursive CTEs, subqueries, and set operations                                                                     |
| Expressions          | Comparison, boolean, arithmetic, null, range, membership, aggregate, window, string, JSON scalar reads, definition-backed and raw casts, cases, parameterized SQL templates, custom expressions, and branded deterministic schema expressions                                                                                                                                            |
| SQL type metadata    | Portable domains and capabilities, physical column storage descriptors, `SqlTypeOf`, projected SQL type maps, `SourceLike` and `TableLike` field constraints, contextual literals, typed extension values, calls, and casts, plus a permissive `SqlUnknown` fallback                                                                                                                     |
| Write queries        | `INSERT` values, defaults, and selects; `UPDATE`; `DELETE`; typed assignments; `RETURNING`; and explicit unrestricted-write opt-in                                                                                                                                                                                                                                                       |
| Rendering            | Standard, PostgreSQL, SQLite, MySQL, and user-created policies for identifiers, placeholders, pagination, row locking, JSON, logical cast targets, schema literals, and EXPLAIN options                                                                                                                                                                                                  |
| Execution boundary   | `QueryAdapter`, opt-in `ExplainableQueryAdapter`, `StreamingQueryAdapter`, and `TransactionalQueryAdapter` capabilities, bound clients from `qubu()`, structured results from `execute()` or `db.execute()`, row-only results from `executeRows()` or `db.rows()`, typed read streams from `stream()` or `db.stream()`, and adapter-decoded plan rows from `explain()` or `db.explain()` |
| Snapshots            | Pure Snapshot v1 and v2 creation, canonical encoding and strict decoding, immutable data, diagnostics, and FNV change-detection fingerprints                                                                                                                                                                                                                                             |
| Introspection        | PostgreSQL, SQLite, and MySQL catalog readers for one selected namespace, normalized catalog data, structured diagnostics, and strict or explicit lossy snapshot mapping                                                                                                                                                                                                                 |
| Snapshot diffing     | Pure Snapshot v1 and v2 comparison, explicit rename evidence, non-authoritative suggestions, and safety diagnostics                                                                                                                                                                                                                                                                      |
| Migration planning   | Pure, dialect-neutral plans with stable ordering, dependency edges, preconditions, explicit review decisions, and tagged custom SQL                                                                                                                                                                                                                                                      |
| DDL emission         | Preflight plus deterministic PostgreSQL, SQLite, and MySQL statements from an approved `MigrationPlan` and matching `SchemaDialect`                                                                                                                                                                                                                                                      |
| Migration operations | Strict artifacts and baselines, authoritative programs, repository and journal validation, adapter capability preflight, execution, status/drift, reconciliation, and SQLite bootstrap                                                                                                                                                                                                   |
| Build tooling        | The optional Vite directive transform and its matching TypeScript ambient declarations                                                                                                                                                                                                                                                                                                   |
| Drizzle conversion   | Optional, dialect-specific runtime conversion from Qubu schema registries to Drizzle tables                                                                                                                                                                                                                                                                                              |
| Source generation    | Pure Snapshot v1 table source printing, deterministic camelCase IDs, exact physical metadata, controlled type mappings, and structured failure diagnostics                                                                                                                                                                                                                               |

## Ownership boundary

Snapshot creation, diffing, migration planning, and DDL emission are pure.
`execute()`, clients, and catalog readers can reach a driver only through
interfaces the application provides. `@qubu/migrate` can orchestrate a sealed
program only through a migration adapter's pinned session and advertised
capabilities; `@qubu/cli` is the Node.js filesystem/process boundary.

| Boundary                 | Qubu side                                                                                                                                                                                                                                                                      | Application side                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Query rendering          | Builds a typed query and renders SQL text with ordered raw parameter values                                                                                                                                                                                                    | Keeps the runtime database schema aligned with query definitions and validates any dynamic syntax passed to an unsafe helper                                                                                                                                                 |
| Query execution          | Binds an adapter with `qubu()` when requested; passes rendered statements and result shapes to execution adapters; applies registered logical field decoders to buffered or streamed object rows; scopes transaction callbacks; returns typed results, plans, rows, or streams | Owns the adapter, driver, connections, pools, cursors, stream cleanup, transactions, savepoints, retries, parameter encoding, proprietary row normalization, decoder policy, plan-row decoding, backpressure, cancellation, driver error translation, and database lifecycle |
| Catalog introspection    | Selects fixed parameterized catalog queries, normalizes rows, and maps catalog data to snapshots                                                                                                                                                                               | Supplies `CatalogConnection`, credentials, already-decoded catalog rows, logging, and connection lifecycle                                                                                                                                                                   |
| Schema source generation | Prints deterministic TypeScript from complete, non-lossy Snapshot v1 introspection without writing files                                                                                                                                                                       | Owns generated-file writes, replacement policy, hand-edit merging, and CLI integration                                                                                                                                                                                       |
| Schema compilation       | Creates snapshots, compares them, builds deterministic migration plans, previews DDL, and compiles authoritative versioned programs                                                                                                                                            | Defines the target snapshot, operation approvals, custom programs, renderer/server constraints, and artifact provenance                                                                                                                                                      |
| Migration operations     | Verifies complete artifact and journal chains; orchestrates pinned sessions, leases, locks, transactions, checkpoints, head CAS, status, baselines, bootstrap, and explicit reconciliation through adapter contracts                                                           | Owns credentials, environment selection, adapter construction, rollout timing, deployment-provider coordination, recovery proof, legacy cutover, and database lifecycle                                                                                                      |

Start with [Dialects and execution](../dialects-and-execution.md) for the query
adapter contract. The schema path is documented in [Canonical schema
snapshots](../schema/snapshots.md), [Snapshot diffing](../schema/diff.md),
[Migration plans](../schema/migration-plans.md), and [DDL
emission](../schema/ddl-emission.md). Continue with [Migration
operations](../migrations/index.md) for artifacts, adapters, CLI use, and
recovery.

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
