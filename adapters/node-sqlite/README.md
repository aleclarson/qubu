# `@qubu/adapter-node-sqlite`

> Adapt a `node:sqlite` DatabaseSync for SQLite queries, EXPLAIN, and callback transactions.

```ts
import { nodeSqliteAdapter } from "@qubu/adapter-node-sqlite"
import { qubu } from "qubu"

// Supply the application-owned client or database described above.
const db = qubu(nodeSqliteAdapter(database))
```

## Limitations

- Requires a Node.js runtime with `node:sqlite`. Database calls are synchronous and block the calling thread despite the adapter’s Promise-based API.
- No query streaming is exposed. Abort signals are checked before execution, but do not cancel an in-flight driver query.
- Transactions default to `BEGIN IMMEDIATE`. No nested transactions/savepoints or transaction queue is exposed; avoid overlapping transactions and unrelated work on the same database during a callback. The application owns database shutdown.
- Statements with result columns, including mutations with `RETURNING`, return rows without `affectedRows` or `insertId` metadata.
- The `/migration` entry point requires a `readSnapshot` callback. It rejects transaction-forbidden phases and shared DDL locks.

See [migration capability profiles](../../docs/migrations/adapters.md) for the
execution requirements of migration entry points.
