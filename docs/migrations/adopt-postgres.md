# Adopt an existing PostgreSQL database

> Capture and accept the existing catalog through `pg`, then review a separate
> migration from that baseline to the desired application schema.

Install `@qubu/cli`, `@qubu/migrate`, `@qubu/adapter-pg`, and `pg`. Use an empty
artifact directory and the application's desired Snapshot v1 as `config.snapshot`.
The `pg` migration adapter now provides strict catalog inspection by default.
An intentional `readSnapshot` override remains available.

## Configure a pinned connection

`pgMigrationAdapter(client)` requires a connected `Client` or an acquired
`PoolClient`. The caller owns connecting, releasing, and ending it. Keep that
connection exclusively available to the migration session until it closes.
Qubu closes its session and releases its locks; it never ends or releases the
supplied client.

For a CLI configuration, this application-owned wrapper connects one client per
session and ends it after Qubu's cleanup. Set `search_path` to the same namespace
as the configured snapshot: inspection selects that namespace explicitly, while
migration journal SQL and unqualified migration statements use `search_path`.
The schema must already exist.

```ts
import { defineConfig } from "@qubu/cli/config"
import { pgMigrationAdapter } from "@qubu/adapter-pg/migration"
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
        const session = await pgMigrationAdapter(client).openMigrationSession(signal)
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

Keep credentials out of candidates and operator metadata. Verify the connection
independently; the reported environment and namespace do not prove database
identity. Stop other migrators and prevent concurrent DDL during cutover. The
advisory lease coordinates participating Qubu runners.

## Review the inspection scope

The standard reader uses the configured snapshot's namespace and physical table
names. Missing managed tables and columns stay missing; expected objects never
fill gaps in the catalog. Other live tables are reported as unmanaged.

Objects attached to excluded tables, including their sequences, triggers,
policies, comments, and ownership, are excluded with them. Namespace-level
objects—including views, free sequences, enums, domains, routines, extensions,
and opaque evidence—remain included. Qubu's reserved `__qubu_migration_` objects
and their attached metadata are excluded. Strict catalog failures remain errors,
even outside selected tables. A managed reference to an excluded object can
therefore require a broader managed scope before capture succeeds.

`readPgMigrationSnapshot(client, expected)` also exposes this reader directly.
Without `expected`, it inspects all non-journal objects in `public`.

## Capture, preflight, and accept

Capture a new candidate file outside the artifact directory:

```bash
qubu migrate baseline-capture --out ./baseline-candidate.json \
  --config ./qubu.config.js --format json
```

Review the actual tables, columns, defaults, constraints, indexes, PostgreSQL
facts, included namespace objects, and reported unmanaged tables. Keep the same
connection, configuration, namespace, and managed scope through acceptance,
including managed tables that are currently absent. The candidate is an ordinary
snapshot; it does not persist the original selection or bind itself to a database.

Preflight rereads that scope against the explicitly reviewed file:

```bash
qubu migrate baseline initial --candidate ./baseline-candidate.json \
  --config ./qubu.config.js --dry-run --format json
```

Capture and preflight do not record migration history or change application
schema/data. Session setup may initialize Qubu journal objects. Preflight and
acceptance require empty artifact and journal history and an identical canonical
snapshot. Changed schema or catalog metadata blocks acceptance. Investigate,
recapture, and review again; do not patch expected facts into the candidate.

Before accepting, verify the [seven adoption acknowledgments](adopt-sqlite.md#accept-the-candidate).
Keep incompatible application code stopped until reconciliation is complete.

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

Acceptance repeats preflight and records the candidate at sequence zero with no
executable program. Preserve the written baseline artifact. If artifact writing
fails after journal recording, inspect both states before proceeding; rerunning
adoption against nonempty history is not a recovery procedure.

## Reconcile the application separately

Keep `config.snapshot` as the desired application snapshot and plan from the
accepted baseline:

```bash
qubu migrate create add-manifest --config ./qubu.config.js --dry-run --format json
```

For example, a captured `game` table lacking `manifest` can become the source for
a separate reviewed add-column migration. Review approvals or custom programs,
create the artifact, and apply it through the [normal workflow](operations.md).

The tested path extends the accepted catalog-native snapshot with a supported
change. Independently authored snapshots can differ in constraint names, native
types, defaults, or dialect metadata even when their SQL seems equivalent.
Adoption keeps conservative comparison; it provides no general SQL equivalence
rules or automatic repairs.

The same flow is available through `captureBaseline`, `preflightBaseline`, and
`createBaseline`; their [API usage](adopt-sqlite.md#use-the-migration-api) and
candidate safeguards are shared across adapters.
