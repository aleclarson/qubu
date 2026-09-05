# `@qubu/drizzle`

> Convert Qubu schema declarations into Drizzle tables while keeping Qubu as the schema authority.

Import `toDrizzleSchema` from `@qubu/drizzle/postgres`, `@qubu/drizzle/mysql`,
or `@qubu/drizzle/sqlite`, then call `toDrizzleSchema(appSchema)`.
The root entry point exports shared types and conversion errors only.
See the [Drizzle guide](../../docs/guides/drizzle.md) for examples.

## Limitations

- Conversion supports PostgreSQL, MySQL, and SQLite. Columns need physical
  storage compatible with the selected dialect; snapshot validation runs first.
- Drizzle has one application value type per column. Qubu columns with different
  select, insert, and update types are rejected at compile time.
- Conversion returns tables only. Declare Drizzle relations separately; this
  package does not adapt a Drizzle client into a Qubu query adapter.
- Deferred constraints, non-simple foreign-key MATCH modes, included index
  columns, and unsupported dialect metadata raise `DrizzleSchemaConversionError`
  with a `code` and `path`. Examples include PostgreSQL `NOT VALID`, MySQL
  unenforced constraints, and SQLite constraint `ON CONFLICT` metadata.
- Explicit index null ordering is supported only for PostgreSQL. Supported
  index extensions are PostgreSQL `method`, `concurrently`, `storageParameters`
  and MySQL `using`, `algorithm`, `lock`; other active extensions are rejected.
- Externally managed generated columns are rejected. External defaults cannot
  supply missing SQL expressions; SQLite rejects them unless a runtime
  `defaultFn` is present. Keep Qubu snapshots and migrations as the DDL authority.
- Identity conversion requires a compatible Drizzle builder. MySQL requires
  autoincrement identity; SQLite AUTOINCREMENT requires a compatible integer
  primary key. Column ON UPDATE conversion is limited to the supported MySQL
  CURRENT_TIMESTAMP form.
- SQLite namespaces remain snapshot metadata and are not attached to Drizzle
  tables.
