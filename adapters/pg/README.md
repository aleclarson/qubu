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

Scoped clients support `transaction()` through savepoints on the same connection.
Catch an inner failure to continue the outer transaction; an uncaught failure
rolls back the outer transaction. Await every query and child scope. Finished
scopes and overlapping scopes reject; failed savepoint recovery prevents commit.
See [nested transactions](../../docs/dialects-and-execution.md#roll-back-part-of-a-transaction)
for an example and lifecycle rules.

## Limitations

- You can also pass a connected `Client` or an already-acquired pool client. The application owns its release and shutdown; Qubu never releases it. Root operations on the same adapter reject during a transaction; raw driver calls and other adapter instances must avoid that pinned client until it finishes.
- No query streaming is exposed. Abort signals are checked before execution, but do not cancel an in-flight driver query.
- The `/migration` entry point requires an already-pinned client and a `readSnapshot` callback. Migration locks support `none` and `exclusive`, not `shared`.

See [migration capability profiles](../../docs/migrations/adapters.md) for the
execution requirements of migration entry points.
