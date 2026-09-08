# Supported features

> Find the right import and check what Qubu supports and what your application manages.

## Package entrypoints

### Query and schema imports

| Import                        | Kind             | Use it for                                                                                                       |
| ----------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `qubu`                        | Runtime          | Ordinary query and schema definitions, reads, writes, SQL templates, rendering, EXPLAIN, and execution contracts |
| `qubu/core`                   | Runtime          | Fragment and rendering primitives, dialect construction, SQL types, and extension constructors                   |
| `qubu/codegen`                | Runtime          | Deterministic machine-owned TypeScript schemas from complete, non-lossy introspection                            |
| `qubu/diff`                   | Runtime          | Canonical Snapshot v1 comparison, rename hints, suggestions, and safety diagnostics                              |
| `qubu/introspection`          | Runtime          | Shared catalog contracts, normalized catalog models, diagnostics, and mapping to Snapshot v1                     |
| `qubu/introspection/postgres` | Runtime          | PostgreSQL catalog reader and catalog queries for one selected namespace                                         |
| `qubu/introspection/sqlite`   | Runtime          | SQLite catalog reader and catalog queries for one selected namespace                                             |
| `qubu/introspection/mysql`    | Runtime          | MySQL catalog reader and catalog queries for one selected namespace                                              |
| `qubu/mysql`                  | Runtime          | The MySQL query dialect policy                                                                                   |
| `qubu/postgres`               | Runtime          | PostgreSQL query dialect helpers such as `postgresDialect()` and `ilike()`                                       |
| `qubu/schema`                 | Runtime          | Advanced schema metadata, storage and constraint models, source models, and schema-expression extensions         |
| `qubu/snapshot`               | Runtime          | Canonical Snapshot v1 traversal, encoding, decoding, diagnostics, and fingerprints                               |
| `qubu/snapshot/mysql`         | Runtime          | MySQL snapshot adapter, schema dialect, and convenience creators                                                 |
| `qubu/snapshot/postgres`      | Runtime          | PostgreSQL snapshot adapter, schema dialect, and convenience creators                                            |
| `qubu/snapshot/sqlite`        | Runtime          | SQLite snapshot adapter, schema dialect, affinity helper, and convenience creators                               |
| `qubu/sqlite`                 | Runtime          | The SQLite query dialect policy and native SQLite column factories                                               |
| `qubu/vite`                   | Runtime          | The optional `qubu()` Vite compiler hint                                                                         |
| `qubu/package.json`           | JSON             | The published package manifest                                                                                   |
| `qubu/globals`                | TypeScript types | Opt-in ambient declarations for directive-bearing modules                                                        |

### Migration imports

| Import                             | Kind            | Use it for                                                                                                       |
| ---------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@qubu/migrate`                    | Runtime         | Migration compiler format identity and shared plan types                                                         |
| `@qubu/migrate/plan`               | Runtime         | Pure migration planning with dependencies, decisions, preconditions, and explicit custom SQL                     |
| `@qubu/migrate/ddl`                | Runtime         | DDL preflight and generic emission from a migration plan and supplied schema dialect                             |
| `@qubu/migrate/ddl/postgres`       | Runtime         | PostgreSQL DDL emission from an approved migration plan                                                          |
| `@qubu/migrate/ddl/sqlite`         | Runtime         | SQLite DDL emission from an approved migration plan                                                              |
| `@qubu/migrate/ddl/mysql`          | Runtime         | MySQL DDL emission from an approved migration plan                                                               |
| `@qubu/migrate/artifact`           | Runtime         | Generic versioned program compilation with a caller-supplied schema dialect, plus strict artifacts and baselines |
| `@qubu/migrate/artifact/postgres`  | Runtime         | PostgreSQL versioned program compilation                                                                         |
| `@qubu/migrate/artifact/sqlite`    | Runtime         | SQLite versioned program compilation, including table rebuilds                                                   |
| `@qubu/migrate/artifact/mysql`     | Runtime         | MySQL versioned program compilation                                                                              |
| `@qubu/migrate/repository`         | Runtime         | Strict full-chain and journal-prefix verification                                                                |
| `@qubu/migrate/journal`            | Runtime         | Storage-neutral journal records, transitions, validation, and reference storage                                  |
| `@qubu/migrate/executor`           | Runtime         | Portable execution, structured errors, checkpointing, and explicit reconciliation                                |
| `@qubu/migrate/baseline`           | Runtime         | Live candidate capture, exact baseline verification, and physical managed-schema comparison                      |
| `@qubu/migrate/status`             | Runtime         | Pending chain, managed drift, unmanaged objects, interrupted attempts, and incompatible requirements             |
| `@qubu/migrate/bootstrap`          | Runtime         | Shared bootstrap preparation, result types, and generic planning with a caller-supplied schema dialect           |
| `@qubu/migrate/bootstrap/postgres` | Runtime         | Fresh PostgreSQL schema planning through the normal diff, plan, and program compiler                             |
| `@qubu/migrate/bootstrap/sqlite`   | Runtime         | Fresh SQLite schema planning through the normal diff, plan, and program compiler                                 |
| `@qubu/migrate/testing`            | Runtime         | Deterministic fake adapters, fault boundaries, and adapter conformance checks                                    |
| `@qubu/cli`                        | Runtime and CLI | `@alloc/cmd-ts` commands, typed config, filesystem repositories, stable output, and exit codes                   |

### Integrations and adapters

| Import                                    | Kind    | Use it for                                                                                              |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `@qubu/pgvector`                          | Runtime | PostgreSQL pgvector columns, dense-vector codecs, distance expressions, and HNSW/IVFFlat index metadata |
| `@qubu/drizzle`                           | Runtime | Shared Drizzle conversion errors and dialect types                                                      |
| `@qubu/drizzle/mysql`                     | Runtime | Runtime conversion from Qubu schemas to MySQL Drizzle tables                                            |
| `@qubu/drizzle/postgres`                  | Runtime | Runtime conversion from Qubu schemas to PostgreSQL Drizzle tables                                       |
| `@qubu/drizzle/sqlite`                    | Runtime | Runtime conversion from Qubu schemas to SQLite Drizzle tables                                           |
| `@qubu/better-auth`                       | Runtime | Better Auth schema derivation and native PostgreSQL, MySQL, and SQLite adapter behavior                 |
| `@qubu/adapter-neon`                      | Runtime | Experimental Neon HTTP PostgreSQL `QueryAdapter` behavior                                               |
| `@qubu/adapter-planetscale`               | Runtime | Experimental PlanetScale serverless MySQL `QueryAdapter` and transaction behavior                       |
| `@qubu/adapter-aws-rds-data-api/postgres` | Runtime | Experimental Aurora PostgreSQL AWS RDS Data API adapter behavior                                        |
| `@qubu/adapter-aws-rds-data-api/mysql`    | Runtime | Experimental Aurora MySQL AWS RDS Data API adapter behavior                                             |
| `@qubu/adapter-sqlite-wasm`               | Runtime | Official SQLite WASM OO1 `QueryAdapter` for browser and web-worker databases                            |

The package validator checks every declared entrypoint in each packed workspace
package. Concrete dialect constructors live on their database subpaths. The
root renderer uses Qubu's standard SQL policy by default.

Snapshot dialect behavior is documented in the [PostgreSQL](postgres-snapshot.md),
[SQLite](sqlite-snapshot.md), and [MySQL](mysql-snapshot.md) support matrices.

## Canonical query vocabulary

Use these names from `qubu` in new query code:

- Equality: `eq`, `ne`.
- Ordering comparisons: `lt`, `lte`, `gt`, `gte`.
- Aggregates: `avg`, `min`, `max`.
- Pagination and aliases: `fetchFirst`, `alias`.
- Rendering and execution: `render`, `qubu`, `execute`.
- Mutations: `deleteFrom`, `allowAll`.

Import advanced fragment and dialect constructors from `qubu/core`, and schema
extensions from `qubu/schema`.

## Capability map

### Schema definitions

- Typed tables and immutable schema registries with namespaces.
- Portable and database-native column storage.
- Defaults, generated columns, and identity metadata.
- Named primary keys, candidate keys, and nullable unique constraints.
- Foreign keys and checks.
- Physical names, included-column indexes, and typed dialect extensions.

### Read queries

- Named projections and spreadable source columns.
- Aliases, joins, and custom or LATERAL sources.
- Correlated subqueries and ordinary or recursive CTEs.
- `WHERE`, `GROUP BY`, and `HAVING`, including grouping checks based on declared keys.
- Ordering, window expressions, and distinct results.
- Pagination, row locking, and set operations.

### Expressions and SQL types

- Comparisons, boolean logic, and arithmetic.
- Null checks, ranges, and membership tests.
- Aggregates, windows, string functions, and `CASE` expressions.
- JSON scalar reads and typed nested JSON results.
- Casts using column definitions or explicit SQL types.
- Parameterized SQL templates and custom expressions.
- Deterministic expressions for schema definitions.
- SQL domains and capabilities, including projected SQL type maps and `SqlTypeOf`.
- Reusable field constraints through `SourceLike` and `TableLike`.
- Contextual literals and typed extension values, calls, and casts.
- Permissive `SqlUnknown` for expressions without a declared SQL domain.

### Write queries

- `INSERT` from values, defaults, or a query.
- Typed `UPDATE` and `DELETE`, including PostgreSQL `UPDATE ... FROM`.
- Typed assignments and PostgreSQL/SQLite conflict clauses.
- MySQL duplicate-key updates and incoming-row references.
- `RETURNING` on supporting dialects.
- Explicit opt-in for writes without a `WHERE` clause.

### Rendering and execution

Standard SQL, PostgreSQL, SQLite, MySQL, and custom dialects control rendering:

- Identifier quoting and placeholders.
- Pagination and row locking.
- JSON and logical cast targets.
- Schema literals and EXPLAIN options.

Execution is available through standalone functions or a client from `qubu()`:

| Result                     | Standalone      | Bound client   |
| -------------------------- | --------------- | -------------- |
| Rows and mutation metadata | `execute()`     | `db.execute()` |
| Rows only                  | `executeRows()` | `db.rows()`    |
| Read stream                | `stream()`      | `db.stream()`  |
| Query plan                 | `explain()`     | `db.explain()` |

`QueryAdapter` handles basic execution. Streaming, EXPLAIN, and transactions
require the matching adapter capabilities.

### Schema tools

- **Snapshots:** immutable Snapshot v1 data, canonical encoding, strict decoding,
  diagnostics, and FNV change-detection fingerprints.
- **Introspection:** PostgreSQL, SQLite, and MySQL readers for one namespace,
  with normalized catalog data and strict or explicitly lossy snapshot mapping.
- **Diffing:** snapshot comparison with explicit rename evidence, suggestions
  for review, and safety diagnostics.
- **Planning:** dialect-neutral migration plans with ordered dependencies,
  preconditions, review decisions, and tagged custom SQL.
- **DDL emission:** preflight checks and repeatable SQL output for an approved
  plan and matching PostgreSQL, SQLite, or MySQL schema dialect.
- **Source generation:** TypeScript table declarations with deterministic
  camelCase IDs, exact physical metadata, controlled type mappings, and diagnostics.

### Migration operations

- Strict migration artifacts and verified baselines.
- Versioned executable programs.
- Repository and journal validation.
- Adapter capability checks before execution.
- Execution, status, drift detection, and reconciliation.
- SQLite bootstrap and complete PostgreSQL bootstrap, including enum ordering.

### Build tools and integrations

- An optional Vite directive transform and matching TypeScript ambient declarations.
- Optional conversion from Qubu schema registries to dialect-specific Drizzle tables.

## Ownership boundary

Snapshot creation, diffing, migration planning, and DDL emission are pure.
`execute()`, clients, and catalog readers can reach a driver only through
interfaces the application provides. `@qubu/migrate` can orchestrate a sealed
program only through a migration adapter's pinned session and advertised
capabilities; `@qubu/cli` is the Node.js filesystem/process boundary.

### Query rendering and execution

Qubu:

- Builds typed queries and renders SQL with ordered raw parameters.
- Passes statements and result shapes to the adapter.
- Decodes buffered or streamed rows with the registered field decoders.
- Creates scoped clients for transaction callbacks.
- Returns typed results, rows, streams, and plans.

Your application and adapter:

- Keep query definitions aligned with the database schema.
- Validate dynamic syntax passed to unsafe helpers.
- Manage drivers, connections, pools, and database lifecycle.
- Manage transactions, savepoints, and retries.
- Bind parameters and normalize driver rows.
- Choose result decoders and decode query-plan rows.
- Manage cursors, stream cleanup, buffering, and cancellation.
- Handle driver-specific errors.

### Catalog introspection and source generation

Qubu runs fixed parameterized catalog queries through `CatalogConnection`,
normalizes the rows, and maps them to snapshots. It can print a TypeScript
schema from a complete introspection result without omitted facts.

Your application supplies:

- `CatalogConnection` and already-decoded catalog rows.
- Credentials, logging, and connection lifecycle.
- Generated-file writes and replacement policy.
- Any hand-edit merging and CLI integration.

### Schema compilation and migration operations

Qubu creates and compares snapshots, builds plans, and compiles SQL previews or
versioned executable programs. The migration executor verifies artifact and
journal chains, then coordinates execution through the adapter:

- Sessions, leases, and locks.
- Transactions and checkpoints.
- Atomic checks and updates of the journal head.
- Status checks and baselines.
- Bootstrap and explicit reconciliation.

Your application supplies:

- The target snapshot and operation approvals.
- Custom programs and renderer/server requirements.
- Artifact provenance.
- Credentials, environment selection, and adapter construction.
- Rollout timing and deployment-provider coordination.
- Proof needed for recovery and decisions about legacy cutover.
- Database lifecycle management.

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
