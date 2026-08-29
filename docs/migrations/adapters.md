# Adapter capability profiles

> Select a migration adapter from capabilities proven by its driver and environment, not from dialect name alone.

Every executable migration adapter opens one pinned migration session and
advertises the exact behavior the executor may use:

| Field                                  | Contract                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `dialect`, `serverVersion`             | Physical target and optional version used for compatibility checks                  |
| `session`                              | Must be `pinned` until `close()` resolves                                           |
| `transactionalDdl`                     | Whether DDL effects can roll back                                                   |
| `optionalTransactions`, `transactions` | Whether optional phases join a transaction and which requirements are proven        |
| `lease`, `leaseKind`                   | Database-backed exclusion of another migration runner                               |
| `locks`                                | Independently supported program DDL lock requirements                               |
| `journal`                              | Database storage, head compare-and-swap, and atomic applied-record/head advancement |
| `parameters`                           | Supported tagged parameter kinds                                                    |
| `commitAmbiguity`                      | Ambiguous commit becomes `recovery-required`                                        |
| `forbiddenPhases`                      | Checkpointed support or explicit rejection                                          |
| `features`                             | Named constraints an artifact may require                                           |

The migrator lease and a program's DDL lock are different controls. The lease
excludes another Qubu runner; a DDL lock protects the database operation. The
executor never treats one as proof of the other.

## Current profiles

The following stable profiles have live conformance coverage in this checkout:

| Migration entrypoint                  | Dialect    | Transactions                  | Locks           | Forbidden phases | Notes                                               |
| ------------------------------------- | ---------- | ----------------------------- | --------------- | ---------------- | --------------------------------------------------- |
| `@qubu/adapter-libsql/migration`      | SQLite     | required, optional            | none, exclusive | unsupported      | Pinned application-owned client                     |
| `@qubu/adapter-node-sqlite/migration` | SQLite     | required, optional            | none, exclusive | unsupported      | Pinned application-owned `DatabaseSync`             |
| `@qubu/adapter-pg/migration`          | PostgreSQL | required, optional, forbidden | none, exclusive | checkpointed     | Caller supplies an already-pinned client            |
| `@qubu/adapter-postgresjs/migration`  | PostgreSQL | required, optional, forbidden | none, exclusive | checkpointed     | Reserves and releases one connection                |
| `@qubu/adapter-pglite/migration`      | PostgreSQL | required, optional, forbidden | none, exclusive | checkpointed     | Uses the database query queue as the pinned session |

All five support every current tagged parameter kind (`null`, `boolean`,
`string`, `number`, `bigint`, `bytes`, and `json`), a database journal and
lease, atomic applied-record/head advancement, and recovery-required commit
ambiguity classification. Support still depends on the artifact's server,
feature, transaction, and lock constraints.

These exported profiles are unavailable and must not be passed to the
executor:

| Export                      | Status            | Reason                                                                              |
| --------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `d1MigrationProfile`        | `incompatible`    | D1 exposes no pinned interactive transaction/session contract                       |
| `mysql2MigrationProfile`    | `not-yet-written` | MySQL implicit-commit lease, checkpoint, and recovery semantics are not live-proven |
| `bunSqliteMigrationProfile` | `not-yet-written` | A Bun-native pinned-session and journal conformance run is missing                  |

Unavailable profiles expose `reason` and `missingCapabilities`; they do not
fall back to a generic executor.

For libSQL, let the migration entrypoint exclude all reserved journal objects
during strict inspection:

```ts
import { createClient } from "@libsql/client"
import { libsqlMigrationAdapter, readLibsqlMigrationSnapshot } from "@qubu/adapter-libsql/migration"

const client = createClient({ url: process.env.DATABASE_URL! })
const adapter = libsqlMigrationAdapter(client, {
  readSnapshot: readLibsqlMigrationSnapshot,
})
```

`DATABASE_URL` remains application configuration; neither the adapter nor CLI
assigns deployment-provider meaning to it.
