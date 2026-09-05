# Adapter capability profiles

> Select a migration adapter from capabilities proven by its driver and environment, not from dialect name alone.

Every executable migration adapter opens a migration session and
advertises the exact behavior the executor may use:

| Field                                  | Contract                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `dialect`, `serverVersion`             | Physical target and optional version used for compatibility checks                     |
| `session`                              | `pinned` for the full lifecycle, or `atomic-batch` for one complete artifact per batch |
| `transactionalDdl`                     | Whether DDL effects can roll back                                                      |
| `optionalTransactions`, `transactions` | Whether optional phases join a transaction and which requirements are proven           |
| `lease`, `leaseKind`                   | Database-backed exclusion of another migration runner                                  |
| `locks`                                | Independently supported program DDL lock requirements                                  |
| `journal`                              | Database storage, head compare-and-swap, and atomic applied-record/head advancement    |
| `parameters`                           | Supported tagged parameter kinds                                                       |
| `commitAmbiguity`                      | Ambiguous commit becomes `recovery-required`                                           |
| `forbiddenPhases`                      | Checkpointed support or explicit rejection                                             |
| `features`                             | Named constraints an artifact may require                                              |

The migrator lease and a program's DDL lock are different controls. The lease
excludes another Qubu runner; a DDL lock protects the database operation. The
executor never treats one as proof of the other.

## Current profiles

The following stable profiles have live conformance coverage in this checkout:

| Migration entrypoint                  | Dialect    | Transactions                  | Locks           | Forbidden phases | Notes                                                  |
| ------------------------------------- | ---------- | ----------------------------- | --------------- | ---------------- | ------------------------------------------------------ |
| `@qubu/adapter-libsql/migration`      | SQLite     | required, optional            | none, exclusive | unsupported      | Single-phase atomic batches through `client.migrate()` |
| `@qubu/adapter-node-sqlite/migration` | SQLite     | required, optional            | none, exclusive | unsupported      | Pinned application-owned `DatabaseSync`                |
| `@qubu/adapter-pg/migration`          | PostgreSQL | required, optional, forbidden | none, exclusive | checkpointed     | Caller supplies an already-pinned client               |
| `@qubu/adapter-postgresjs/migration`  | PostgreSQL | required, optional, forbidden | none, exclusive | checkpointed     | Reserves and releases one connection                   |
| `@qubu/adapter-pglite/migration`      | PostgreSQL | required, optional, forbidden | none, exclusive | checkpointed     | Uses the database query queue as the pinned session    |

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

## libSQL batch execution

Each executable artifact must contain exactly one phase and an embedded before
snapshot. The adapter submits its statements, SQL assertions, applied-history
record, head update, and terminal attempt state in one `client.migrate()` call.
For example, creating a table and recording that migration either both commit
or both roll back. Multiple artifacts are separate batches; earlier successful
artifacts remain applied if a later one fails.

Preparation reads the schema in a read transaction. The submitted batch checks
that the catalog still matches that inspection, the lease is still owned, and
the head still equals the expected parent. Foreign-key validation runs before
commit because libSQL temporarily disables enforcement during `migrate()`.

Schema fingerprint and property preconditions are checked against the embedded
before snapshot, whose physical facts are verified during preparation and
guarded by the in-batch catalog assertion. Object-presence and scalar SQL checks
run inside the batch. Postconditions must be object-presence/absence checks
without fingerprints, or scalar SQL checks returning `1`. Unsupported conditions,
multiple phases, and transaction/connection-control statements are rejected.
Each program entry must contain one executable statement. Leading empty
statements and comments cannot hide transaction control such as `;COMMIT`.
Semicolons inside quoted SQL and trigger bodies remain supported.

The database-row lease has no expiry or heartbeat. A process crash can leave
it held; ownership must be resolved before another runner can proceed. A lost
batch response is an uncertain outcome requiring journal inspection and, when
the attempt remains unresolved, explicit recovery. It is never assumed to be
a successful rollback.
