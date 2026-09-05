# `@qubu/adapter-pg`

> Adapt a pinned `pg` client for PostgreSQL queries, EXPLAIN, and callback transactions.

```ts
import { pgAdapter } from "@qubu/adapter-pg"
import { qubu } from "qubu"

// Supply the application-owned client or database described above.
const db = qubu(pgAdapter(client))
```

## Limitations

- Pass a connected `Client` or an acquired pool client, not a `Pool`. The application owns connection release and shutdown. Keep unrelated queries and overlapping transactions off this client while a transaction is active.
- No query streaming is exposed. Abort signals are checked before execution, but do not cancel an in-flight driver query.
- Nested transactions/savepoints are not exposed by the transaction-scoped adapter.
- The `/migration` entry point requires an already-pinned client and a `readSnapshot` callback. Migration locks support `none` and `exclusive`, not `shared`.

See [migration capability profiles](../../docs/migrations/adapters.md) for the
execution requirements of migration entry points.
