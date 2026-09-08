# `@qubu/adapter-mysql2`

> Adapt one `mysql2/promise` connection for MySQL queries, EXPLAIN, and callback transactions.

```ts
import { mysql2Adapter } from "@qubu/adapter-mysql2"
import { qubu } from "qubu"

// Supply the application-owned client or database described above.
const db = qubu(mysql2Adapter(connection))
```

Scoped clients support `transaction()` through savepoints on the same connection.
Catch an inner failure to continue the outer transaction; an uncaught failure
rolls back the outer transaction. Await every query and child scope. Finished
scopes and overlapping scopes reject; failed savepoint recovery prevents commit.
See [nested transactions](../../docs/dialects-and-execution.md#roll-back-part-of-a-transaction)
for an example and lifecycle rules.

## Run SQL migrations

Use `migrate` with one dedicated `mysql2/promise` connection and an
append-only list of migrations. Each `sql` entry is one complete statement;
the runner does not split SQL files. New migrations run in the order supplied.

```ts
import mysql from "mysql2/promise"
import { migrate } from "@qubu/adapter-mysql2/migration"

const connection = await mysql.createConnection(process.env.DATABASE_URL!)
try {
  const result = await migrate(connection, [
    {
      id: "001-create-accounts",
      sql: ["CREATE TABLE accounts (id INT PRIMARY KEY, name VARCHAR(255))"],
    },
    {
      id: "002-add-email",
      sql: ["ALTER TABLE accounts ADD email VARCHAR(255)"],
    },
  ])
  console.log(result.applied)
} finally {
  await connection.end()
}
```

The first run returns both IDs. Subsequent runs skip recorded IDs and return
`[]` until you append another migration. Completion records, SQL hashes, and
timestamps are stored in `__qubu_mysql2_migrations` in the selected database.
Hashes are recorded for reference, not checked against later edits. Keep IDs
unique and permanent, and never edit or reorder completed migrations.

Run only one migrator at a time, with autocommit enabled and no active
transaction or other work on its connection. MySQL schema changes commit
implicitly. A failed migration can leave partial changes without a completion
record, including when its SQL succeeds but the history write fails. Inspect
and repair the database before retrying; the runner does not automatically
roll back, resume, or reconcile failures.

The runner consumes SQL you supply and does not accept sealed executable
artifacts or inspect schemas before applying SQL. To adopt an existing database,
use `captureBaseline`, `preflightBaseline`, and `createBaseline` from the same
entry point. They capture and accept reviewed live facts without changing
application schema/data; see [MySQL adoption](../../docs/migrations/adopt-mysql.md).
Possible stronger execution guarantees are tracked in
[issue #1](https://github.com/aleclarson/qubu/issues/1).

## Limitations

- Use a connected or acquired pool connection. The application owns release/shutdown and must avoid raw driver calls or other adapter instances using that connection during a transaction. Root operations on the same adapter reject during a transaction; use its scoped client.
- No streaming is exposed. Results must be a single object-row result set or mutation header; multiple result sets are unsupported. The adapter forces `rowsAsArray: false` and `nestTables: false`.
- Abort signals are checked before and after driver calls, but do not cancel in-flight SQL. An abort can be reported after a mutation or commit has succeeded; do not interpret it as proof of rollback.
- The shared executor profile, `mysql2MigrationProfile`, remains `not-yet-written`. `migrate` is a separate basic runner and does not provide that profile's lease, checkpoint, or recovery guarantees.

See [migration capability profiles](../../docs/migrations/adapters.md) for the
execution requirements of migration entry points.
