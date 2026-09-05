# `@qubu/adapter-mysql2`

> Adapt one `mysql2/promise` connection for MySQL queries, EXPLAIN, and callback transactions.

```ts
import { mysql2Adapter } from "@qubu/adapter-mysql2"
import { qubu } from "qubu"

// Supply the application-owned client or database described above.
const db = qubu(mysql2Adapter(connection))
```

## Limitations

- Use a connected or acquired pool connection. The application owns release/shutdown and must avoid overlapping transactions or unrelated work on that connection during a transaction.
- No streaming or nested transactions/savepoints are exposed. Results must be a single object-row result set or mutation header; multiple result sets are unsupported. The adapter forces `rowsAsArray: false` and `nestTables: false`.
- Abort signals are checked before and after driver calls, but do not cancel in-flight SQL. An abort can be reported after a mutation or commit has succeeded; do not interpret it as proof of rollback.
- The `/migration` entry point exports only `mysql2MigrationProfile` with status `not-yet-written`. It is not an executable migration adapter; MySQL implicit-commit recovery semantics remain unproven.

See [migration capability profiles](../../docs/migrations/adapters.md) for the
execution requirements of migration entry points.
