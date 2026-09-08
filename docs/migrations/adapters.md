# Adapter capability profiles

> Choose a migration adapter based on what its driver and environment have been tested to support.

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

## Trusted migration SQL

Qubu validates program structure and adapter capabilities. It trusts the SQL
you supply, including SQL conditions, and does not parse it for safety.

Migration SQL must preserve the executor’s transactions, connection settings,
and journal state. For example, an explicit `COMMIT` can apply schema changes
without their journal record, breaking the executor’s recovery guarantees.

## Current profiles

The following stable profiles have live conformance coverage in this checkout:

| Migration entrypoint                  | Dialect    | Transactions                  | Locks           | Forbidden phases | Notes                                                  |
| ------------------------------------- | ---------- | ----------------------------- | --------------- | ---------------- | ------------------------------------------------------ |
| `@qubu/adapter-libsql/migration`      | SQLite     | required, optional            | none, exclusive | unsupported      | Single-phase atomic batches through `client.migrate()` |
| `@qubu/adapter-node-sqlite/migration` | SQLite     | required, optional            | none, exclusive | unsupported      | Pinned application-owned `DatabaseSync`                |
| `@qubu/adapter-pg/migration`          | PostgreSQL | required, optional, forbidden | none, exclusive | checkpointed     | Caller supplies an already-pinned client               |
| `@qubu/adapter-postgresjs/migration`  | PostgreSQL | required, optional, forbidden | none, exclusive | checkpointed     | Reserves and releases one connection                   |
| `@qubu/adapter-pglite/migration`      | PostgreSQL | required, optional, forbidden | none, exclusive | checkpointed     | Uses the database query queue as the pinned session    |

All five support:

- Every current tagged parameter kind.
- A journal and migrator lease stored in the database.
- An atomic update of the applied record and journal head.
- A recovery-required result when a commit’s outcome is uncertain.

Parameter kinds are:

- `null` and `boolean`.
- `string` and `number`.
- `bigint` and `bytes`.
- `json`.

The artifact’s server, feature, transaction, and lock requirements must still
match the adapter.

### Unavailable profiles

MySQL has a [basic SQL migration runner](../../adapters/mysql2/README.md#run-sql-migrations),
`migrate`, which executes pending statements and records completed
migrations. It runs independently of the shared executor and its stronger
capability contract. The MySQL profile below remains unavailable; possible
improvements are tracked in [issue #1](https://github.com/aleclarson/qubu/issues/1).
The same entry point supports [reviewed MySQL adoption](adopt.md#mysql) through
`captureBaseline`, `preflightBaseline`, and `createBaseline`.

These exported profiles are unavailable and must not be passed to the
executor:

| Export                      | Status            | Reason                                                                              |
| --------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `d1MigrationProfile`        | `incompatible`    | D1 exposes no pinned interactive transaction/session contract                       |
| `mysql2MigrationProfile`    | `not-yet-written` | MySQL implicit-commit lease, checkpoint, and recovery semantics are not live-proven |
| `bunSqliteMigrationProfile` | `not-yet-written` | A Bun-native pinned-session and journal conformance run is missing                  |

Unavailable profiles expose `reason` and `missingCapabilities`; they do not
fall back to a generic executor.

### Configure libSQL inspection

For libSQL, let the migration entrypoint exclude all reserved journal objects
during strict inspection:

```ts
import { createClient } from "@libsql/client"
import { migrationAdapter, readMigrationSnapshot } from "@qubu/adapter-libsql/migration"

const client = createClient({ url: process.env.DATABASE_URL! })
const adapter = migrationAdapter(client, {
  readSnapshot: readMigrationSnapshot,
})
```

`DATABASE_URL` remains application configuration; neither the adapter nor CLI
assigns deployment-provider meaning to it.

## libSQL batch execution

Each executable artifact must contain exactly one phase and an embedded before
snapshot. The adapter submits its statements, SQL assertions, applied-history
record, head update, and terminal attempt state in one `client.migrate()` call.
For example, creating a table and recording that migration either both commit
or both roll back.

Multiple artifacts are separate batches; earlier successful
artifacts remain applied if a later one fails.

Preparation reads the schema in a read transaction. The submitted batch checks
that the catalog still matches that inspection, the lease is still owned, and
the head still equals the expected parent. Foreign-key validation runs before
commit because libSQL temporarily disables enforcement during `migrate()`.

### Supported conditions

Schema fingerprint and property preconditions are checked against the embedded
before snapshot. Preparation verifies its physical facts, and the batch
asserts that the catalog still matches.

Object-presence and scalar SQL checks run inside the batch. Postconditions
must use either:

- Object-presence or absence checks without fingerprints.
- Scalar SQL checks returning `1`.

Unsupported conditions and multiple phases are rejected.

SQL is passed to the driver without safety validation. Each program entry
must follow the driver’s statement contract.

### Crashes and uncertain outcomes

The database-row lease has no expiry or heartbeat. A process crash can leave
it held; ownership must be resolved before another runner can proceed. A lost
batch response is an uncertain outcome requiring journal inspection and, when
the attempt remains unresolved, explicit recovery. It is never assumed to be
a successful rollback.
