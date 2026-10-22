# Run transactions

> Use adapter-owned transaction scopes and savepoints, and keep work inside its active scope.

Use a transactional adapter when several queries must share one commit or
rollback boundary:

The examples assume queries named `readQuery`, `firstMutation`,
`secondMutation`, and `optionalMutation`, built with the read and mutation
guides.

```ts
import { qubu } from "qubu"
import type { TransactionalQueryAdapter } from "qubu"

declare const transactionalAdapter: TransactionalQueryAdapter
const db = qubu(transactionalAdapter)

const result = await db.transaction(async (transaction) => {
  await transaction.execute(firstMutation)
  await transaction.execute(secondMutation)
  return transaction.rows(readQuery)
})
```

The adapter owns connection pinning, commit, rollback, and release. Qubu
creates the scoped client and returns the callback result; it emits no
transaction SQL itself.

A scoped client's methods follow its adapter's capabilities: `execute()` and
`rows()` are always available; EXPLAIN and streaming require their respective
capabilities. `TransactionOptions.signal` is passed to the adapter. Isolation
levels and other driver-specific settings remain adapter-specific.

## Roll back part of a transaction

The pg, mysql2, and node:sqlite adapters expose `transaction()` on scoped
clients through the shared `NestedTransactionalQueryAdapter` capability.
Other adapters retain their existing transaction surface. For example, with a
bound pg client, catch a nested failure to keep earlier work:

```ts
import { pgAdapter } from "@qubu/adapter-pg"
import { Pool } from "pg"

const pgDb = qubu(pgAdapter(new Pool()))

await pgDb.transaction(async (outer) => {
  await outer.execute(firstMutation)
  try {
    await outer.transaction(async (inner) => {
      await inner.execute(optionalMutation)
    })
  } catch (error) {
    // The nested work was rolled back; the outer transaction can continue.
  }
  await outer.execute(secondMutation)
})
```

Each nested callback uses a uniquely named savepoint on the same connection.
Success releases it; failure rolls back to it and releases it. Letting the
failure escape also rolls back the outer transaction. Failed savepoint creation
or recovery makes the entire transaction unsafe to commit, even if the callback
catches the error. Primary and cleanup failures are retained in `AggregateError`.

### Finish work before leaving a scope

Await every query and nested transaction before returning. These three adapters
reject:

- Calls on a finished scoped client.
- Overlapping sibling scopes.
- A child scope started while its parent has pending queries.
- Parent queries while a child is active.

If a callback finishes with work pending, the adapter waits for that work and
rolls back.

Use the active scoped client for all work on a directly supplied connection.
Its root client rejects unrelated operations during the transaction. A pg pool
can still run independent queries on other connections.

Your application remains responsible for raw driver calls and separately
constructed adapters.

EXPLAIN and result decoding remain available at every depth. Nested transaction
hooks identify their enclosing transaction with `parentId`; queries identify
their immediate scope. Cancellation does not interrupt savepoint recovery.

## Lock selected rows

For locking reads inside a transaction, add `rowLock()` to the `SELECT`:

```ts
import { eq, from, integer, rowLock, select, table, where } from "qubu"

const jobs = table("jobs", { id: integer() })
const claimedJob = select(
  { id: jobs.id },
  from(jobs),
  where(eq(jobs.id, 7)),
  rowLock("update", "skip-locked"),
)
```

PostgreSQL supports all four Qubu modes. MySQL supports `update` and `share`;
`key-share` and `no-key-update` fail during rendering. The standard and SQLite
dialects reject row-locking queries. Qubu does not start a transaction for a
locking query or validate every database restriction on locking syntax.
