# Introspection support

> Look up which catalog facts each adapter reads, which versions it accepts, and which database features remain outside Snapshot v1.

The optional `qubu/introspection` entrypoint reads one selected database
namespace through a user-owned `CatalogConnection`. It returns normalized
catalog data and can map that data to canonical Snapshot v1 or v2. The
application owns the driver and connection lifecycle. Snapshot diffing,
migration planning, and DDL emission are separate Qubu capabilities; see the
[ownership map](supported-surface.md#ownership-boundary).

## Version and namespace baseline

| Adapter    | Baseline | Selected namespace            | Product policy                      |
| ---------- | -------- | ----------------------------- | ----------------------------------- |
| PostgreSQL | 12+      | one PostgreSQL schema         | PostgreSQL only                     |
| SQLite     | 3.37+    | one database, normally `main` | attached databases are not combined |
| MySQL      | 8.0.16+  | one MySQL database            | MariaDB requires a separate adapter |

Version and product failures are structured diagnostics. The adapters do not
silently downgrade to a different product's catalog rules.

## Catalog facts

| Fact                        | PostgreSQL                                                                                                                                          | SQLite                                                                                   | MySQL                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Tables and visible columns  | `pg_class`, `pg_attribute`                                                                                                                          | `sqlite_schema`, `table_xinfo`                                                           | `TABLES`, `COLUMNS`                                                                                                                 |
| Native storage              | `format_type`                                                                                                                                       | declared type                                                                            | `COLUMN_TYPE`                                                                                                                       |
| Defaults                    | `pg_get_expr`                                                                                                                                       | `dflt_value`                                                                             | `COLUMN_DEFAULT`                                                                                                                    |
| Generated columns           | stored expressions                                                                                                                                  | stored/virtual when CREATE SQL is recoverable                                            | stored/virtual and `GENERATION_EXPRESSION`                                                                                          |
| Identity behavior           | `attidentity`                                                                                                                                       | `INTEGER PRIMARY KEY`, `AUTOINCREMENT`                                                   | `AUTO_INCREMENT`                                                                                                                    |
| Keys and foreign keys       | `pg_constraint`                                                                                                                                     | table metadata and `foreign_key_list`                                                    | `TABLE_CONSTRAINTS`, `KEY_COLUMN_USAGE`, `REFERENTIAL_CONSTRAINTS`                                                                  |
| Checks                      | `pg_constraint` and decompiled definition                                                                                                           | CREATE SQL                                                                               | `CHECK_CONSTRAINTS`                                                                                                                 |
| Indexes                     | `pg_index`, access method, decompiled terms                                                                                                         | `index_list`, `index_xinfo`, schema SQL                                                  | `STATISTICS`                                                                                                                        |
| Complete PostgreSQL objects | views/materialized views, sequences, enums/domains, collations, triggers, routines, partitions, row-level policies, comments/owners, and extensions | N/A                                                                                      | N/A                                                                                                                                 |
| Complete SQLite objects     | N/A                                                                                                                                                 | views and triggers when CREATE SQL is recoverable; table/view columns from `table_xinfo` | N/A                                                                                                                                 |
| Complete MySQL objects      | N/A                                                                                                                                                 | N/A                                                                                      | typed views and view columns, routines and parameters, triggers, partitions, used collations, comments, and opaque scheduled events |
| Unsupported MySQL families  | N/A                                                                                                                                                 | N/A                                                                                      | sequences, materialized views, row-level security (RLS) policies, extensions, and ownership                                         |
| Deferred or opaque objects  | foreign tables and relation kinds without a safe typed mapping                                                                                      | virtual/shadow tables, attached-database boundaries, and unrecoverable definitions       | scheduled events are opaque; unknown or other non-base table rows are deferred                                                      |

The readers preserve physical names and use database catalog identifiers only
as current-run join keys. The normalized catalog keeps opaque SQL and its
source, whether it came from a catalog value, a database decompiler, or CREATE
SQL.

## PostgreSQL complete catalog surface

The PostgreSQL reader also fills the complete normalized catalog used by
Snapshot v2. It keeps PostgreSQL OIDs in current-run physical references and
keeps decompiler output such as `pg_get_viewdef`, `pg_get_triggerdef`, and
`pg_get_functiondef` as tagged SQL data. It does not evaluate that text.

The query and normalization layout follows the catalog-oriented parts of the
[Drizzle PostgreSQL introspector](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/src/introspect-pg.ts),
while Qubu keeps the result as typed data instead of generating TypeScript
declarations.

Use `mapCatalogToCompleteSnapshot()` for this object set. Use
`mapCatalogToSnapshot()` when a caller explicitly needs the existing table-only
Snapshot v1.

## SQLite complete catalog surface

The SQLite reader uses fixed statements over `sqlite_schema` and the
table-valued PRAGMAs `database_list`, `table_list`, `table_xinfo`,
`index_list`, `index_xinfo`, and `foreign_key_list`. Each table-valued PRAGMA
receives bound namespace or object parameters through the caller's
`CatalogConnection`. The reader does not interpolate a database name into SQL.

SQLite views and triggers become typed complete catalog objects when their
CREATE SQL has a recoverable definition and target. Their SQL remains tagged
opaque data with a `sqlite` dialect and a catalog reference. Generated column
expressions, declared storage types, SQLite affinity, rowid aliases, and
`AUTOINCREMENT` are kept as column or identity dialect extensions. User indexes
retain ordered column or expression terms and partial predicates. Inline UNIQUE
constraints are recovered from their internal indexes with deterministic Qubu
names, so SQLite's `sqlite_autoindex_*` names do not become persisted logical
IDs.

SQLite virtual tables and shadow tables remain typed deferred objects with an
`unmodeled-object` diagnostic. A selected attached database can expose table
PRAGMA rows, but its schema SQL is outside the fixed `main` and `temp`
statements. Qubu marks that result as limited and keeps other attached
databases as opaque boundary records. It never combines attached databases into
the selected namespace. SQLite does not provide the PostgreSQL object families
such as routines, materialized views, policies, or ownership, so the reader
does not fabricate them.

`mapCatalogToCompleteSnapshot()` retains the typed views, triggers, deferred
objects, opaque boundaries, and dialect extensions in Snapshot v2. The existing
`mapCatalogToSnapshot()` still maps only tables and preserves Snapshot v1
behavior.

The query and normalization seams follow the catalog-reading portions of the
[Drizzle SQLite introspector](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/src/introspect-sqlite.ts).
Drizzle's module generates source declarations; Qubu keeps the same SQLite
metadata sources as normalized data and never evaluates database-provided SQL.

## MySQL 8 complete catalog surface

The MySQL reader accepts MySQL 8.0.16 and later within the MySQL 8 series. It
rejects MariaDB and older MySQL versions instead of applying MySQL catalog
rules to a different product or server version. It reads `INFORMATION_SCHEMA`
rows for one selected database and retains database-provided SQL as tagged,
unevaluated MySQL data.

MySQL has typed complete records for views, routines and their parameters,
triggers, partitions, collations used by selected tables or columns, and
comments. View definitions come from `INFORMATION_SCHEMA.VIEWS`; each view's
columns are joined back to the matching `COLUMNS` rows by physical table name,
so the complete Snapshot v2 cross-reference points at the view's own column
IDs. Missing view definitions or unresolved trigger, partition, or other
object references become deferred records with diagnostics.

Scheduled events are retained as `CatalogOpaqueObject` records. Their event
metadata and definition remain opaque, and the reader emits an
`unmodeled-object` warning. Snapshot v2 keeps these records in
`opaqueObjects`; they are not treated as typed routines, triggers, or
migration operations.

The MySQL reader does not expose typed sequences or materialized views. A
sequence-like or other non-base table row is retained as a deferred object
when the catalog reports one. MySQL row-level security (RLS) policies,
extension objects, and ownership are unsupported complete families. Definers on
views, routines, triggers, and events remain dialect metadata; they do not
become ownership records. The corresponding capability flags are false.

The query and normalization layout follows the catalog-reading portions of the
[Drizzle MySQL introspector](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/src/introspect-mysql.ts),
while Qubu keeps the result as typed data instead of generating TypeScript
declarations.

Use `mapCatalogToCompleteSnapshot()` to retain these typed MySQL families and
the opaque or deferred boundaries in Snapshot v2. Use `mapCatalogToSnapshot()`
when a caller explicitly needs the existing table-only Snapshot v1.

## Snapshot v1 surface

The mapper can emit these facts in canonical Snapshot v1:

- one namespace and ordinary tables;
- exact dialect-native column storage;
- nullability and unambiguous literal or opaque SQL defaults;
- generated columns with stored or virtual mode;
- identities kept separate from defaults and generated columns;
- primary, unique, nullable-unique, foreign-key, and check constraints;
- ordered column or expression index terms, predicates, included columns, and
  representable dialect extensions;
- stable logical IDs with physical names preserved separately.

Strict mode returns no snapshot when a supported table fact cannot be mapped
soundly. Lossy mode is explicit and marks warnings in the result. A digest is
canonical content, not an identity or rename marker.

## Deferred and limited features

The following remain catalog facts or diagnostics rather than fabricated
Snapshot v1 objects:

- views and materialized views;
- sequences, enums, domains, routines, triggers, policies, extensions,
  collations, comments, and partition metadata;
- PostgreSQL identity sequence options that have no typed Snapshot v1 field;
- SQLite virtual/shadow tables, attached namespaces, and unrecoverable
  generated or expression definitions;
- MySQL/MariaDB differences, prefix indexes, invisible indexes, and advanced
  functional, full-text, or spatial index semantics.

Use the complete catalog and Snapshot v2 mapper to retain supported PostgreSQL
and MySQL families. MySQL scheduled events stay opaque, and MySQL sequences,
materialized views, row-level security (RLS) policies, extension objects, and
ownership stay unsupported or deferred. When a row cannot be normalized safely, the reader
keeps a typed deferred or opaque record and emits a diagnostic instead of
dropping it.

## Upstream references

The dialect reader structure follows useful patterns from Drizzle Kit while
keeping Qubu's output data-only:

- [Drizzle PostgreSQL introspector](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/src/introspect-pg.ts)
- [Drizzle SQLite introspector](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/src/introspect-sqlite.ts)
- [Drizzle MySQL introspector](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/src/introspect-mysql.ts)

Those modules generate TypeScript declarations. Qubu instead keeps catalog
normalization separate from Snapshot v1 mapping so future diffing and planning
do not depend on source-code generation.

See [Database introspection](../schema/introspection.md) for the connection
adapter example, identity rules, diagnostics, and the later diff/planning
boundary. See the [PostgreSQL](postgres-snapshot.md),
[SQLite](sqlite-snapshot.md), and [MySQL](mysql-snapshot.md) snapshot pages for
the pure serialization adapters.
