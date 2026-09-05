# `@qubu/adapter-pg`

> Use an application-owned `pg` pool or connected client for PostgreSQL queries, EXPLAIN, and callback transactions.

```ts
import { pgAdapter } from "@qubu/adapter-pg"
import { Pool } from "pg"
import { qubu } from "qubu"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const db = qubu(pgAdapter(pool))

await db.transaction(async (transaction) => {
  // Run related queries with transaction.execute(...).
})

// At application shutdown, after all work has finished:
await pool.end()
```

Ordinary queries and EXPLAIN use the pool directly. Each transaction acquires
one client for BEGIN, callback queries, and COMMIT or ROLLBACK, then releases it.
Concurrent transactions and unrelated pool queries use separate connections.
A failed BEGIN or failed rollback discards the acquired client. Transaction and
cleanup failures are preserved together in an `AggregateError`. Qubu never
shuts down the application-owned pool.

## Limitations

- You can also pass a connected `Client` or an already-acquired pool client. The application owns its release and shutdown; Qubu never releases it. Keep unrelated queries and overlapping transactions off that pinned client while a transaction is active.
- No query streaming is exposed. Abort signals are checked before execution, but do not cancel an in-flight driver query.
- Nested transactions/savepoints are not exposed by the transaction-scoped adapter.
- The `/migration` entry point requires an already-pinned client and a `readSnapshot` callback. Migration locks support `none` and `exclusive`, not `shared`.

See [migration capability profiles](../../docs/migrations/adapters.md) for the
execution requirements of migration entry points.
