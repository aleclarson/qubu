# Adopt an existing database

> Capture and accept the live schema as migration history's starting point, then
> reconcile it with the application's desired schema separately.

If the live `game` table lacks `manifest`, the captured baseline must also lack
it. Adoption changes no application schema/data and does not certify that the
desired application version can run. Keep incompatible code stopped until a
separate reviewed migration reconciles the schema.

## Choose an adapter

All supported adoption adapters use the same [CLI](#shared-cli) and
[API](#shared-api). Each checks an empty artifact repository and its own history.

| Database and adapter    | History storage            | Coordination                                         |
| ----------------------- | -------------------------- | ---------------------------------------------------- |
| SQLite through `libsql` | Migration journal          | Adapter lease coordinates participating Qubu runners |
| PostgreSQL through `pg` | Migration journal          | Pinned client and advisory lease                     |
| MySQL through `mysql2`  | `__qubu_mysql2_migrations` | Caller serializes runners; no database lease         |

Adoption does not require migration execution capabilities. MySQL supports the
shared adoption commands while retaining its basic SQL runner for subsequent
migrations. See [adapter profiles](adapters.md) for execution contracts.

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

## Shared CLI

Install `@qubu/cli`, `@qubu/migrate`, and the selected adapter and driver.
Configure the [CLI](operations.md#configuration) with the existing database,
desired application snapshot, and an empty artifact directory. Standard `libsql`
and `pg` migration adapters provide strict inspection; intentional `readSnapshot`
overrides remain caller-owned. The CLI accepts either a migration adapter or an
adoption-only `baselineAdapter` in `config.adapter`. See the connection examples
for [PostgreSQL](#postgresql-configuration) and [MySQL](#mysql).

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

Import adoption operations from `@qubu/migrate/baseline` and `baselineAdapter`
from the selected driver's `/migration` entry point. For example, with a
dedicated MySQL connection:

```ts
import { baselineAdapter } from "@qubu/adapter-mysql2/migration"
import { captureBaseline } from "@qubu/migrate/baseline"
import { encodeSchemaSnapshot } from "qubu/snapshot"
import { writeFile } from "node:fs/promises"

const adapter = baselineAdapter(connection)
const inspection = await captureBaseline({ adapter, scope: desiredSnapshot })
await writeFile("baseline-candidate.json", encodeSchemaSnapshot(inspection.snapshot), {
  flag: "wx",
})
```

Review the candidate before continuing. Reuse the same database and original
scope, and reload the reviewed file for preflight and acceptance:

```ts
import { readFile, writeFile } from "node:fs/promises"
import { preflightBaseline, createBaseline } from "@qubu/migrate/baseline"
import { encodeBaselineArtifact } from "@qubu/migrate/artifact"
import { assertSchemaSnapshot } from "qubu/snapshot"

const candidate = assertSchemaSnapshot(await readFile("baseline-candidate.json", "utf8"))
const input = { adapter, scope: desiredSnapshot, candidate, repository: [] }
await preflightBaseline(input)

const { artifact } = await createBaseline({
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

Supply the real artifact repository when one exists; `[]` represents an empty
repository. The adapter separately verifies its database history. The caller
owns connection cleanup, including after failed capture or acceptance.

Existing custom migration adapters can use `fromMigrationAdapter(adapter)` from
`@qubu/migrate/baseline`. It reuses their strict reader, lease, and journal. A
custom adoption-only adapter implements `openBaselineSession`; its session
provides schema inspection, empty-history verification, baseline recording,
and cleanup. It does not need SQL execution or migration recovery methods.

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

Use a dedicated `mysql2/promise` connection with autocommit enabled and no active
transaction. This configuration opens a connection per adoption session and
ends it after cleanup. Run the [shared CLI commands](#shared-cli) with this config:

```ts
import { defineConfig } from "@qubu/cli/config"
import { baselineAdapter } from "@qubu/adapter-mysql2/migration"
import mysql from "mysql2/promise"
import snapshot from "./schema.snapshot.js"

export default defineConfig({
  artifacts: "./migrations",
  snapshot,
  environment: "production",
  provenance: { source: "my-service" },
  adapter: () => ({
    async openBaselineSession(scope, signal) {
      const connection = await mysql.createConnection(process.env.DATABASE_URL!)
      try {
        const session = await baselineAdapter(connection).openBaselineSession(scope, signal)
        return {
          ...session,
          async close() {
            try {
              await session.close()
            } finally {
              await connection.end()
            }
          },
        }
      } catch (error) {
        await connection.end()
        throw error
      }
    },
  }),
})
```

Acceptance inserts one baseline record in `__qubu_mysql2_migrations`. Its
`baseline` column contains the full sealed artifact, including the reviewed
snapshot, provenance, and acknowledgments. The CLI also writes that artifact to
the configured repository.

This adoption-only configuration cannot run `migrate apply`, `status`, or
`reconcile`, which require the shared migration executor. Use the basic MySQL
runner for subsequent SQL migrations as shown below.

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
