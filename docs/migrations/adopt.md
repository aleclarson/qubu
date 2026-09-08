# Adopt an existing database

> Capture and accept the live schema as migration history's starting point, then
> reconcile it with the application's desired schema separately.

If the live `game` table lacks `manifest`, the captured baseline must also lack
it. Adoption changes no application schema/data and does not certify that the
desired application version can run. Keep incompatible code stopped until a
separate reviewed migration reconciles the schema.

## Choose an adapter

| Database and adapter    | Adoption interface                          | Empty state required                                      | Coordination                                         |
| ----------------------- | ------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| SQLite through `libsql` | [Shared CLI or API](#sqlite-and-postgresql) | Artifact repository and migration journal                 | Adapter lease coordinates participating Qubu runners |
| PostgreSQL through `pg` | [Shared CLI or API](#sqlite-and-postgresql) | Artifact repository and migration journal                 | Pinned client and advisory lease                     |
| MySQL through `mysql2`  | [Basic adapter API](#mysql)                 | SQL migration list and `__qubu_mysql2_migrations` history | Caller serializes runners; no database lease         |

MySQL's basic profile does not support the shared artifact executor or
`qubu migrate baseline` CLI. Its accepted baseline is stored in its own history
table. See [adapter profiles](adapters.md) for the execution contracts.

Configure the desired application Snapshot v1 as the managed `scope`
(`config.snapshot` for the CLI). Preserve the same database, namespace, adapter,
and original scope through acceptance, including tables that are currently
absent. A candidate does not persist that original selection or bind itself to
a particular database. Verify the connection independently; reported selectors
do not prove database identity. Keep credentials out of snapshots and metadata.

### Inspection scope

Standard readers select managed tables by their expected physical names and
preserve logical identities. Expected facts never fill missing tables or columns.
Other live tables are reported as unmanaged.

| Adapter  | Connection and namespace                                                                                                                                           | Other inspected objects                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libsql` | Configure the existing database as in [CLI configuration](operations.md#configuration)                                                                             | Non-table objects retain the adapter's inspection policy; strict inspection can reject unsupported facts outside selected tables                                                                              |
| `pg`     | Connected `Client` or acquired `PoolClient`; keep `search_path` equal to the scope's existing namespace; see [PostgreSQL configuration](#postgresql-configuration) | Excluded tables take their sequences, triggers, policies, comments, and ownership with them. Namespace-level views, free sequences, enums, domains, routines, extensions, and opaque evidence remain included |
| `mysql2` | Dedicated connection, autocommit enabled, no active transaction; the selected database must equal the scope's database                                             | Excluded tables take attached triggers, partitions, and comments with them. Namespace-level views, routines, used collations, and opaque evidence remain included                                             |

Readers exclude reserved `__qubu_migration_` objects and their attached metadata;
MySQL also excludes `__qubu_mysql2_migrations`. Strict catalog failures remain
errors. A managed reference to an excluded object can require a broader scope.

The adapters expose `readMigrationSnapshot` directly. Without an expected scope,
the `pg` reader inspects non-journal objects in `public`; the `mysql2` reader uses
the selected database. Use `captureBaseline` for adoption so journal setup
precedes inspection, including any catalog facts introduced by that setup.

## Capture, review, and verify

1. **Capture** the actual managed schema to a new candidate file. The candidate
   is an ordinary Snapshot v1, not a migration artifact. Keep it outside the
   shared artifact directory and refuse to overwrite an existing candidate.
2. **Review** its tables, columns, defaults, constraints, indexes, comments,
   dialect facts, included namespace objects, and reported unmanaged tables.
3. **Preflight** the explicitly reviewed file against a fresh inspection of the
   original scope. Require empty history and an identical canonical snapshot,
   including metadata. Changed facts or a newly appeared managed table block
   acceptance. Investigate, recapture, and review; do not patch expected facts
   into the candidate to hide differences.
4. **Accept** only after verifying the acknowledgments below. Acceptance repeats
   preflight and records a non-executable baseline at sequence zero with a null
   parent. Preserve the returned or written artifact.

Capture and preflight record no baseline and change no application schema/data.
Session setup may initialize Qubu history tables and perform lease bookkeeping.
Stop other migrators and prevent concurrent DDL throughout cutover. Leases
coordinate participating Qubu runners, not every possible schema writer.
Preflight needs no acceptance confirmations. Comparison failures include
diagnostics and actual snapshot evidence when available.

### Acceptance acknowledgments

All seven facts must be true. The application acknowledgment means incompatible
code remains stopped; it does not assert that desired code is already compatible.

| CLI confirmation                     | What the operator verifies                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `database-target`                    | The configured connection targets the intended database and environment            |
| `snapshot-source`                    | The selected candidate was captured and reviewed using the unchanged managed scope |
| `zero-managed-drift`                 | Fresh strict inspection has zero differences from the reviewed candidate           |
| `backup-restore-ready`               | Backup and restore procedures are ready                                            |
| `other-migrators-stopped`            | Other runners are stopped and concurrent DDL is prevented                          |
| `incompatible-application-prevented` | Incompatible code will remain stopped until reconciliation is complete             |
| `legacy-history-cutover`             | The team accepts this baseline as the new lineage start                            |

## SQLite and PostgreSQL

Install `@qubu/cli`, `@qubu/migrate`, and the selected adapter and driver.
Configure the [CLI](operations.md#configuration) with the existing database,
desired application snapshot, and an empty artifact directory. Standard `libsql`
and `pg` migration adapters provide strict inspection; intentional `readSnapshot`
overrides remain caller-owned.

Capture and review:

```bash
qubu migrate baseline-capture --out ./baseline-candidate.json \
  --config ./qubu.config.js --format json
```

The CLI refuses to overwrite the file and reports the config path, environment,
dialect, namespace, configured managed tables, included tables, and exclusions.
After reviewing that output and candidate, run preflight:

```bash
qubu migrate baseline initial --candidate ./baseline-candidate.json \
  --config ./qubu.config.js --dry-run --format json
```

Once all [acknowledgments](#acceptance-acknowledgments) are verified, accept:

```bash
qubu migrate baseline initial --candidate ./baseline-candidate.json \
  --config ./qubu.config.js \
  --confirm database-target \
  --confirm snapshot-source \
  --confirm zero-managed-drift \
  --confirm backup-restore-ready \
  --confirm other-migrators-stopped \
  --confirm incompatible-application-prevented \
  --confirm legacy-history-cutover \
  --format json --non-interactive
```

### Shared API

The same flow is available from `@qubu/migrate/baseline`. Call
`captureBaseline({ adapter, scope })`, serialize its snapshot with
`encodeSchemaSnapshot`, and reload the reviewed file for verification:

```ts
import { preflightBaseline } from "@qubu/migrate/baseline"
import { assertSchemaSnapshot } from "qubu/snapshot"

await preflightBaseline({
  adapter,
  scope: desiredSnapshot,
  candidate: assertSchemaSnapshot(reviewedCandidateText),
  repository,
})
```

`createBaseline` takes those inputs plus `id`, `provenance`, and the seven
`BaselineConfirmation` fields shown in the [MySQL acceptance example](#mysql).
It returns the artifact for the caller to persist.

### PostgreSQL configuration

The caller owns connecting, releasing, and ending the pinned `pg` client. Keep
it exclusively available until the migration session closes. Qubu releases its
locks and closes its session; it never releases or ends the supplied client.

This CLI wrapper opens a client per session and ends it after cleanup. Set
`search_path` to the snapshot namespace: inspection selects it explicitly, while
journal SQL and unqualified migration statements use `search_path`.

```ts
import { defineConfig } from "@qubu/cli/config"
import { migrationAdapter } from "@qubu/adapter-pg/migration"
import { Client } from "pg"
import snapshot from "./schema.snapshot.js"

export default defineConfig({
  artifacts: "./migrations",
  snapshot,
  environment: "production",
  provenance: { source: "my-service" },
  adapter: () => ({
    async openMigrationSession(signal) {
      const connectionString = process.env.DATABASE_URL
      if (!connectionString) throw new Error("DATABASE_URL is required")
      const client = new Client({ connectionString })
      try {
        await client.connect()
        const namespace = '"' + snapshot.namespace.name.replaceAll('"', '""') + '"'
        await client.query("SELECT set_config('search_path', $1, false)", [namespace])
        const session = await migrationAdapter(client).openMigrationSession(signal)
        const close = session.close.bind(session)
        let closed = false
        session.close = async () => {
          if (closed) return
          closed = true
          try {
            await close()
          } finally {
            await client.end()
          }
        }
        return session
      } catch (error) {
        await client.end()
        throw error
      }
    },
  }),
})
```

## MySQL

Use one dedicated `mysql2/promise` connection with no active transaction and
autocommit enabled. Start with an empty SQL migration list and empty Qubu MySQL
history. Capture to a new file, then stop to review it:

```ts
import mysql from "mysql2/promise"
import { writeFile } from "node:fs/promises"
import { captureBaseline } from "@qubu/adapter-mysql2/migration"
import { encodeSchemaSnapshot } from "qubu/snapshot"
import scope from "./schema.snapshot.js"

const connection = await mysql.createConnection(process.env.DATABASE_URL!)
try {
  const inspection = await captureBaseline(connection, { scope })
  await writeFile("baseline-candidate.json", encodeSchemaSnapshot(inspection.snapshot), {
    flag: "wx",
  })
  console.log(inspection.unmanagedObjects)
} finally {
  await connection.end()
}
```

For preflight and acceptance, open a dedicated connection to the same database,
reuse the original `scope`, and close the connection in `finally` as above.
Reload the explicitly reviewed file. Only accept after verifying every
[acknowledgment](#acceptance-acknowledgments):

```ts
import { readFile, writeFile } from "node:fs/promises"
import { preflightBaseline, createBaseline } from "@qubu/adapter-mysql2/migration"
import { encodeBaselineArtifact } from "@qubu/migrate/artifact"
import { assertSchemaSnapshot } from "qubu/snapshot"

const candidate = assertSchemaSnapshot(await readFile("baseline-candidate.json", "utf8"))
const input = { scope, candidate, migrations: [] }
await preflightBaseline(connection, input)

const { artifact } = await createBaseline(connection, {
  ...input,
  id: "initial",
  provenance: { source: "my-service" },
  confirmation: {
    databaseTargetVerified: true,
    snapshotSourceVerified: true,
    zeroManagedDriftVerified: true,
    backupRestoreReady: true,
    otherMigratorsStopped: true,
    incompatibleApplicationPrevented: true,
    legacyHistoryCutoverAccepted: true,
  },
})
await writeFile("baseline-accepted.json", encodeBaselineArtifact(artifact), { flag: "wx" })
```

Acceptance inserts one baseline record in `__qubu_mysql2_migrations`. Its
`baseline` column contains the full sealed artifact, including the reviewed
snapshot, provenance, and acknowledgments.

## After acceptance

If recording or artifact-file writing fails, inspect history and saved files
before retrying. The shared CLI records the journal before writing the artifact;
MySQL can lose an insert response after the record commits. Rerunning adoption
against nonempty history is not a recovery procedure. For MySQL, inspect:

```sql
SELECT id, hash, baseline FROM __qubu_mysql2_migrations WHERE id = 'initial';
```

Reconcile the desired application schema in a separate reviewed migration.
For SQLite/PostgreSQL, keep `config.snapshot` as the desired snapshot and plan
from the accepted baseline:

```bash
qubu migrate create add-manifest --config ./qubu.config.js --dry-run --format json
```

Review approvals or custom programs, create the artifact, and apply it through
the [normal workflow](operations.md). The tested path extends the captured
catalog snapshot with a supported change. Independently authored snapshots can
differ in constraint names, native types, defaults, or dialect metadata even
when their SQL seems equivalent. Adoption adds no general SQL equivalence rules
or automatic repairs.

For MySQL, review changes against the accepted snapshot and append SQL migrations
with distinct, permanent IDs:

```ts
import { migrate } from "@qubu/adapter-mysql2/migration"

await migrate(connection, [{ id: "add-manifest", sql: ["ALTER TABLE game ADD manifest JSON"] }])
```

The basic runner skips completed IDs. It does not check live schema drift before
subsequent migrations or consume sealed executable artifacts. Partial failures
still require inspection before retrying.
