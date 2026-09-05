# `@qubu/adapter-node-sqlite`

> Adapt a `node:sqlite` DatabaseSync for SQLite queries, EXPLAIN, and callback transactions.

```ts
import { nodeSqliteAdapter } from "@qubu/adapter-node-sqlite"
import { qubu } from "qubu"

// Supply the application-owned client or database described above.
const db = qubu(nodeSqliteAdapter(database))
```

Scoped clients support `transaction()` through savepoints on the same connection.
Catch an inner failure to continue the outer transaction; an uncaught failure
rolls back the outer transaction. Await every query and child scope. Finished
scopes and overlapping scopes reject; failed savepoint recovery prevents commit.
See [nested transactions](../../docs/dialects-and-execution.md#roll-back-part-of-a-transaction)
for an example and lifecycle rules.

## Limitations

- Requires Node.js `>=22.16.0` with `node:sqlite`. Database calls are synchronous and block the calling thread despite the adapter’s Promise-based API.
- The default encoder maps portable `boolean` values to SQLite `0`/`1`, `date` values to `YYYY-MM-DD`, `timestamp` values to ISO text, and `json` values to JSON text. A custom `encoder` replaces this policy and receives each parameter’s aligned SQL domain.
- No query streaming is exposed. Abort signals are checked before execution, but do not cancel an in-flight driver query.
- Transactions default to `BEGIN IMMEDIATE`. There is no transaction queue. Root operations on the same adapter reject while a callback owns the connection; use its scoped client. The application owns database shutdown.
- Statements with result columns, including mutations with `RETURNING`, return rows without `affectedRows` or `insertId` metadata.
- Result rows are normalized to objects with their rendered aliases even when the application configured `DatabaseSync` with `returnArrays: true`. Statements with result columns, including mutations with `RETURNING`, return rows without `affectedRows` metadata.
- Generic mutations omit `insertId`: SQLite’s connection-level `lastInsertRowid` can be stale for ignored and `WITHOUT ROWID` inserts. Use `RETURNING` when the inserted identifier is needed.
- The `/migration` entry point requires a `readSnapshot` callback. It rejects transaction-forbidden phases and shared DDL locks.

See [migration capability profiles](../../docs/migrations/adapters.md) for the
execution requirements of migration entry points.
