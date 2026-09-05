# `@qubu/adapter-libsql`

> Adapt an application-owned `@libsql/client` for SQLite queries, EXPLAIN, and callback transactions.

```ts
import { libsqlAdapter } from "@qubu/adapter-libsql"
import { qubu } from "qubu"

// Supply the application-owned client or database described above.
const db = qubu(libsqlAdapter(client))
```

## Limitations

- No query streaming is exposed. Abort signals are checked before execution, but do not cancel an in-flight driver query.
- Transactions default to libSQL’s `write` mode. Nested transactions/savepoints are not exposed. The adapter closes transaction handles; the application owns the client’s lifetime.
- The `/migration` entry point rejects transaction-forbidden phases and shared DDL locks. Its default snapshot reader uses strict SQLite introspection; custom readers must exclude reserved `__qubu_migration_` objects.

See [migration capability profiles](../../docs/migrations/adapters.md) for the
execution requirements of migration entry points.
