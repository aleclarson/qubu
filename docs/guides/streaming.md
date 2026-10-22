# Stream query results

> Consume read queries incrementally while keeping cursor cleanup inside the adapter’s scope.

Use an adapter implementing `StreamingQueryAdapter`. Only `SELECT` and
set-operation queries can stream; mutations with `RETURNING` still use
`execute()` or `executeRows()`.

```ts
import { from, integer, qubu, select, table } from "qubu"
import type { StreamingQueryAdapter } from "qubu"

declare const adapter: StreamingQueryAdapter
const db = qubu(adapter)
const users = table("users", { id: integer() })
const readQuery = select({ id: users.id }, from(users))
declare function consume(row: typeof readQuery.row): void

for await (const row of db.stream(readQuery)) {
  consume(row)
}
```

The standalone equivalent is `stream(readQuery, adapter)`. A plain
`QueryAdapter` does not expose streaming just because its driver has a cursor
API; the adapter must supply the capability.

Qubu renders the query with the selected dialect before calling `stream()`. It
passes ordered raw parameters, query kind, result shape, and the optional
`AbortSignal` in the same `ExecutionRequest` used by `execute()`. The adapter
binds values and returns the iterable. Qubu lazily decodes each row without
opening a cursor or connection, buffering rows, or imposing a fetch size.

## Keep cursor resources inside their scope

The adapter owns the iterator's cleanup contract:

| Event                           | Adapter responsibility                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Normal completion               | Close the cursor and release stream-only resources before the iterable completes.                             |
| Early iterator close            | Implement `return()` so a consumer can stop without leaking resources.                                        |
| Iteration failure               | Close the cursor and release resources before the failure reaches the consumer.                               |
| Aborted signal                  | Stop the driver operation and clean up any open stream resources.                                             |
| Transaction callback completion | Consume or close every stream before the callback resolves, then commit or release the transaction resources. |

Consume or close the iterator before its transaction callback resolves. Qubu
does not keep a transaction open for a stream that escapes its callback.

Inside a transaction, use a `StreamingTransactionalQueryAdapter` so the
transaction callback receives a streaming client. The adapter must keep its
cursor and connection valid until the callback's streams finish or close:

```ts
declare const transactionalAdapter: import("qubu").StreamingTransactionalQueryAdapter
const transactionalDb = qubu(transactionalAdapter)

await transactionalDb.transaction(async (transaction) => {
  for await (const row of transaction.stream(readQuery)) {
    consume(row)
  }
})
```

The adapter decides how `next()` drives driver reads, whether it prefetches,
and how much data it buffers. Qubu only forwards the async-iterator protocol
and the abort signal. Driver errors and cancellation errors pass through
unchanged.

A call to `stream()` renders and invokes the adapter immediately. Row decoding
is lazy. A stream that is never consumed still needs adapter-owned cleanup;
Qubu cannot guarantee cleanup for an abandoned iterable. See [stream hook
timing](hooks.md#stream-observation-timing) when instrumenting consumption.
