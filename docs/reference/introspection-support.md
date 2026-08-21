# Introspection support

> Look up which catalog facts each adapter reads, which versions it accepts, and which database features remain outside Snapshot v1.

The optional `qubu/introspection` entrypoint reads one selected database
namespace through a user-owned `CatalogConnection`. It returns normalized
catalog data and can map that data to canonical Snapshot v1. It does not own a
driver, connection lifecycle, migration planner, or DDL generator.

## Version and namespace baseline

| Adapter    | Baseline | Selected namespace            | Product policy                      |
| ---------- | -------- | ----------------------------- | ----------------------------------- |
| PostgreSQL | 12+      | one PostgreSQL schema         | PostgreSQL only                     |
| SQLite     | 3.37+    | one database, normally `main` | attached databases are not combined |
| MySQL      | 8.0.16+  | one MySQL database            | MariaDB requires a separate adapter |

Version and product failures are structured diagnostics. The adapters do not
silently downgrade to a different product's catalog rules.

## Catalog facts

| Fact                       | PostgreSQL                                  | SQLite                                        | MySQL                                                              |
| -------------------------- | ------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| Tables and visible columns | `pg_class`, `pg_attribute`                  | `sqlite_schema`, `table_xinfo`                | `TABLES`, `COLUMNS`                                                |
| Native storage             | `format_type`                               | declared type                                 | `COLUMN_TYPE`                                                      |
| Defaults                   | `pg_get_expr`                               | `dflt_value`                                  | `COLUMN_DEFAULT`                                                   |
| Generated columns          | stored expressions                          | stored/virtual when CREATE SQL is recoverable | stored/virtual and `GENERATION_EXPRESSION`                         |
| Identity behavior          | `attidentity`                               | `INTEGER PRIMARY KEY`, `AUTOINCREMENT`        | `AUTO_INCREMENT`                                                   |
| Keys and foreign keys      | `pg_constraint`                             | table metadata and `foreign_key_list`         | `TABLE_CONSTRAINTS`, `KEY_COLUMN_USAGE`, `REFERENTIAL_CONSTRAINTS` |
| Checks                     | `pg_constraint` and decompiled definition   | CREATE SQL                                    | `CHECK_CONSTRAINTS`                                                |
| Indexes                    | `pg_index`, access method, decompiled terms | `index_list`, `index_xinfo`, schema SQL       | `STATISTICS`                                                       |
| Deferred objects           | views, sequences, and other relation kinds  | views and triggers                            | views and non-base tables                                          |

The readers preserve physical names and use database catalog identifiers only
as current-run join keys. The normalized catalog keeps opaque SQL and its
source, whether it came from a catalog value, a database decompiler, or CREATE
SQL.

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

Use the normalized catalog to inspect these facts. Add a typed dialect
extension or a future snapshot version before making them migration input.

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
