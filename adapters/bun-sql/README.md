# `@qubu/adapter-bun-sql`

> Adapt an application-owned Bun.SQL client for queries, EXPLAIN, and callback transactions.

```ts
import { bunSqlAdapter } from "@qubu/adapter-bun-sql"
import { qubu } from "qubu"
import { sqliteDialect } from "qubu/sqlite"

// Supply the application-owned client or database described above.
const db = qubu(bunSqlAdapter(sql, { dialect: sqliteDialect() }))
```

## Limitations

- An explicit Qubu dialect is required and must match the client’s backend. The adapter does not detect or validate the backend for you.
- No query streaming or nested transactions/savepoints are exposed. The application owns client shutdown.
- Query abort signals call the Bun query handle’s `cancel()` method. Synchronous SQLite execution cannot be interrupted once it starts. A transaction signal is checked before the transaction and after its callback; it does not itself cancel every query in that callback.
- Mutation counts and insert IDs are returned only when Bun supplies the corresponding metadata. Insert IDs use `lastInsertRowid` only.
- The `/migration` entry point exports only `bunSqliteMigrationProfile` with status `not-yet-written`. No executable migration adapter is provided.

See [migration capability profiles](../../docs/migrations/adapters.md) for the
execution requirements of migration entry points.
