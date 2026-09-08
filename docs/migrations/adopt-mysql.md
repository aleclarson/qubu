# Adopt an existing MySQL database

> Capture and accept the actual MySQL schema, then apply separate SQL migrations
> to reconcile it with the application.

Use the `mysql2` adapter's basic migration API with one dedicated
`mysql2/promise` connection with no active transaction. Keep autocommit enabled,
stop other migrators, and prevent concurrent DDL throughout capture, review, and acceptance. These APIs
do not acquire a database lease. They use the basic runner's history table;
the shared artifact executor and `qubu migrate baseline` CLI are not supported
by this profile.

The flow matches [SQLite adoption](adopt-sqlite.md): capture actual facts,
review them, recheck the original scope, and accept the candidate. For example,
if the live `game` table lacks `manifest`, the candidate must also lack it.
Adoption does not make incompatible application code safe to run.

## Capture and review

Start with an empty SQL migration list and empty Qubu MySQL history. Configure
`scope` as a Snapshot v1 for the desired application schema. Its database name
must match the connection's selected database. Preserve this original scope
through acceptance, including tables that do not exist yet.

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

Review the saved candidate's tables, columns, defaults, constraints, indexes,
comments, and MySQL facts. Physical table names select the managed tables;
expected facts never fill catalog gaps. Other tables are reported as unmanaged.
Their attached triggers, partitions, and comments are excluded with them.
Namespace-level views, routines, used collations, and opaque evidence remain
included. Strict catalog failures and unresolved managed relationships block
capture; broaden the scope when a managed foreign key needs an excluded table.

`readMigrationSnapshot(connection, scope)` exposes the strict reader directly.
Without a scope, it reads the selected database's non-journal objects. Use
`captureBaseline` for adoption: it initializes history before inspection so
catalog facts introduced by journal setup are present throughout the flow.
Capture changes no application schema/data and records no baseline.

## Recheck and accept

Reload the explicitly reviewed candidate. Reuse the same database and original
scope, rather than using the candidate's list of currently present tables.

```ts
import { readFile, writeFile } from "node:fs/promises"
import { preflightBaseline, createBaseline } from "@qubu/adapter-mysql2/migration"
import { encodeBaselineArtifact } from "@qubu/migrate/artifact"
import { assertSchemaSnapshot } from "qubu/snapshot"

const candidate = assertSchemaSnapshot(await readFile("baseline-candidate.json", "utf8"))
const input = { scope, candidate, migrations: [] }
await preflightBaseline(connection, input)

// Accept only after verifying every acknowledgment below.
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

Use a connected, dedicated `connection` and close it in `finally`, as in the
capture example. Verify the [seven acknowledgments](adopt-sqlite.md#accept-the-candidate)
before accepting. Keep credentials out of snapshots and provenance.

Preflight requires empty history and an empty SQL migration list. It compares
the fresh canonical snapshot with the reviewed candidate exactly, including
metadata. Changed facts or a newly appeared managed table require recapture
and review. Preflight records nothing; acceptance repeats it before writing.

Acceptance inserts one non-executable baseline record in
`__qubu_mysql2_migrations`. Its `baseline` column contains the full sealed
artifact, including the reviewed snapshot, provenance, and acknowledgments.
It does not execute application DDL or copy the desired schema into the database.
Preserve the returned artifact as review evidence. If the insert response or
file write fails, inspect the stored record before retrying adoption:

```sql
SELECT id, hash, baseline FROM __qubu_mysql2_migrations WHERE id = 'initial';
```

## Apply the next SQL migration

After acceptance, append reviewed SQL migrations using distinct, permanent IDs:

```ts
import { migrate } from "@qubu/adapter-mysql2/migration"

await migrate(connection, [{ id: "add-manifest", sql: ["ALTER TABLE game ADD manifest JSON"] }])
```

The baseline remains in history and existing rows remain in place. Repeating a
completed SQL migration skips its ID. The basic runner does not check schema
drift before subsequent migrations or consume sealed executable artifacts.
Use the accepted snapshot as the source when reviewing differences against the
desired schema; no general SQL equivalence detection or automatic repair is
provided. Partial migration failures still require inspection before retrying.
