# `@qubu/adapter-postgresjs`

> Adapt an application-owned postgres.js client for PostgreSQL queries, EXPLAIN, and callback transactions.

```ts
import { postgresJsAdapter } from "@qubu/adapter-postgresjs"
import { qubu } from "qubu"

// Supply the application-owned client or database described above.
const db = qubu(postgresJsAdapter(sql))
```

## Limitations

- No query streaming is exposed. Abort signals are checked before execution, but do not cancel an in-flight driver query.
- Nested transactions/savepoints are not exposed by the transaction-scoped adapter. Configure transaction SQL options with `beginOptions`; the application owns client shutdown.
- The `/migration` entry point requires a `readSnapshot` callback. It reserves and releases one connection; migration locks support `none` and `exclusive`, not `shared`.

See [migration capability profiles](../../docs/migrations/adapters.md) for the
execution requirements of migration entry points.
