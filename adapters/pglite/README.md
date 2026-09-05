# `@qubu/adapter-pglite`

> Adapt an application-owned PGlite database for PostgreSQL queries, EXPLAIN, and callback transactions.

```ts
import { pgliteAdapter } from "@qubu/adapter-pglite"
import { qubu } from "qubu"

// Supply the application-owned client or database described above.
const db = qubu(pgliteAdapter(database))
```

## Limitations

- No query streaming is exposed. Abort signals are checked before execution, but do not cancel an in-flight driver query.
- Nested transactions/savepoints are not exposed by the transaction-scoped adapter. The application owns database initialization and shutdown.
- The `/migration` entry point requires a `readSnapshot` callback and uses the database query queue as its pinned session. Keep unrelated work off that database during migrations. Migration locks support `none` and `exclusive`, not `shared`.

See [migration capability profiles](../../docs/migrations/adapters.md) for the
execution requirements of migration entry points.
