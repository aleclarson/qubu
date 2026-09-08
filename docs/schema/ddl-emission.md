# DDL emission

> Preview the SQL for a migration plan before preparing it for execution.

The `@qubu/migrate/ddl` entrypoint accepts only a `MigrationPlan` and a `SchemaDialect`.
It does not read a catalog, open a connection, start a transaction, or write a
migration journal. Preflight runs before rendering, so a blocked or incompatible
plan returns diagnostics and no SQL.

```ts
import { emitMigrationPlan } from "@qubu/migrate/ddl"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"

const result = emitMigrationPlan(plan, postgresSchemaDialect)
if (!result.ok) {
  // Review result.diagnostics. result.sql is an empty string.
  throw new Error(result.diagnostics.map((item) => item.message).join("\n"))
}

for (const statement of result.statements) {
  console.log(statement.operationId, statement.sql, statement.parameters)
}
```

`statements` contains the SQL preview in dependency order. Each statement has:

- Its operation ID.
- Its position in that order.
- SQL text.
- An ordered parameter list.

Schema literals and expressions are parameter-free by contract. `sql` joins
the statements with a newline and adds a semicolon for migration-file writers.

## Review gates

The emitter rejects a plan with `ready: false`, `decision-required` operations,
unknown or lossy facts, unsupported safety, or destructive changes unless the
caller supplies the matching explicit option.

`allowUnsafe` is available for
preview integrations, but it is not accepted as an artifact approval and does
not make an opaque object renderable. Opaque and deferred catalog records need
an explicit tagged `custom-sql` operation for preview and an operation-scoped
custom program for sealed execution.

### Check execution requirements

Lock and transaction requirements describe what a later executor must provide.
Pass `lock` or `transaction` to preflight those requirements against the
executor's context. A required transaction with `transaction: 'autocommit'`
produces `transaction-conflict`; no transaction is opened by the emitter.

```ts
const result = emitMigrationPlan(plan, postgresSchemaDialect, {
  transaction: "managed",
  lock: "exclusive",
  serverVersion: "16",
})
```

## First-party support

| Object or operation                             | PostgreSQL               | SQLite                                                                   | MySQL                    |
| ----------------------------------------------- | ------------------------ | ------------------------------------------------------------------------ | ------------------------ |
| Tables, columns, constraints, indexes           | yes                      | tables, columns, and indexes; constraints require an inline/rebuild path | yes                      |
| Views                                           | yes                      | yes                                                                      | yes                      |
| Materialized views                              | yes                      | no                                                                       | no                       |
| Sequences, enums, domains, policies, extensions | yes                      | no                                                                       | no                       |
| Routines                                        | functions and procedures | no                                                                       | functions and procedures |
| Partitions                                      | yes                      | no                                                                       | add/drop partition forms |
| Triggers                                        | yes                      | yes                                                                      | yes                      |
| Comments and ownership                          | yes                      | no                                                                       | table comments only      |
| Explicit custom SQL                             | dialect tag must match   | dialect tag must match                                                   | dialect tag must match   |

The support table describes syntax Qubu can render from modeled snapshot facts.
Server-version checks still apply, such as SQLite column rename and drop-column
limits and MySQL check-constraint support. An unsupported operation is reported
as a diagnostic rather than silently omitted. SQLite table constraints are not
emitted as `ALTER TABLE ... ADD CONSTRAINT`; use a schema snapshot that carries
an inline constraint declaration or an explicit rebuild/custom-SQL operation.

Custom SQL stays opaque and appears at its plan position. The emitter does not
inspect it for object names or infer SQL from an opaque catalog record.

## Prepare for execution

For execution, compile the plan with `compileMigrationProgram()` from
`@qubu/migrate/artifact`. The versioned program—not the aggregate `sql`
string—is authoritative. See [Artifacts and approval
policy](../migrations/artifacts-and-policy.md).

CREATE TABLE statements follow column `ordinalPosition` values, preserving schema
declaration order across PostgreSQL, MySQL, and SQLite. Snapshot arrays remain
sorted by ID for deterministic serialization; array order does not determine DDL
column order.
