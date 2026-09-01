# Command line operations

> Configure, inspect, baseline, and apply a complete migration chain with stable non-interactive behavior.

Install the CLI, migration library, and one verified migration adapter. For a
libSQL application:

```bash
pnpm add @qubu/cli @qubu/migrate @qubu/adapter-libsql @libsql/client
```

The `qubu` binary is implemented with `@alloc/cmd-ts`. It loads
`qubu.config.js` by default; `--config <path>` selects another application-owned
module. Every command accepts `--format human|json` (default `human`) and
`--non-interactive`. Commands do not prompt today; `--non-interactive` records
the deployment contract and missing explicit input still fails.

## Configuration

Export a typed config and keep credentials inside the adapter factory:

```ts
import { createClient } from "@libsql/client"
import { libsqlMigrationAdapter, readLibsqlMigrationSnapshot } from "@qubu/adapter-libsql/migration"
import { defineConfig } from "@qubu/cli/config"
import snapshot from "./schema.snapshot.js"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is required")

export default defineConfig({
  artifacts: "./migrations",
  snapshot,
  environment: "production",
  adapter: () =>
    libsqlMigrationAdapter(createClient({ url }), {
      readSnapshot: readLibsqlMigrationSnapshot,
    }),
  provenance: { source: "my-service" },
})
```

`snapshot` may be a value or async factory. Alternatively provide both
`schema` and `snapshotFromSchema`. Optional configuration owns operation
approvals, custom programs, renderer/server constraints, baseline operator
metadata, and reconciliation proof. `artifacts` is resolved from the CLI
working directory.

| Field                                      | Required            | Meaning                                                                                      |
| ------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------- |
| `artifacts`                                | yes                 | Artifact directory, relative to the command working directory unless absolute                |
| `snapshot`                                 | one snapshot source | Snapshot value or sync/async factory                                                         |
| `schema` + `snapshotFromSchema`            | one snapshot source | Application-owned conversion when the source is a Qubu `Schema`                              |
| `adapter`                                  | database commands   | Sync/async factory returning a migration adapter                                             |
| `approvals`                                | no                  | Sync/async operation policy; receives the operation, finding codes, and requested CLI reason |
| `customPrograms`                           | no                  | Exact operation substitutions with execution requirements and provenance                     |
| `renderer`, `serverVersion`, `constraints` | no                  | Renderer identity and target compatibility constraints                                       |
| `provenance`                               | no                  | Artifact source/revision/actor/metadata; defaults to `{ source: "@qubu/cli" }`               |
| `environment`                              | no                  | `development`, `test`, `staging`, or `production`; context only                              |
| `baselineOperator`                         | no                  | JSON-safe operator metadata stored in a baseline                                             |
| `verifyReconciliation`                     | reconcile only      | Application-owned proof of the selected live outcome                                         |

## Commands

| Syntax                                                                                              | Reads or writes                                                                                                                             | Important failure behavior                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `qubu migrate create <id> [--approve <operation-id=reason>...] [--approved-by <actor>] [--dry-run]` | Verifies the full repository, plans from its embedded final snapshot, seals, then writes one canonical artifact unless dry-run              | Unknown operation IDs or missing exact approvals fail policy                                                   |
| `qubu migrate verify`                                                                               | Strictly decodes and verifies every artifact and the complete chain                                                                         | Any malformed, tampered, forked, gapped, or mismatched artifact fails validation                               |
| `qubu migrate status`                                                                               | Opens a session and lease; reports managed drift, unmanaged objects, pending artifacts, interrupted attempts, and incompatible requirements | Recovery, validation, drift, and capability policy are distinct failures                                       |
| `qubu migrate apply [--dry-run]`                                                                    | Applies the complete verified pending chain; dry-run performs status/preflight only                                                         | It never limits discovery to Git-added or branch-diff files                                                    |
| `qubu migrate baseline <id> --confirm <fact>... [--dry-run]`                                        | Without dry-run, strictly compares the live managed schema, initializes an empty journal, records baseline, then writes the artifact        | Requires an empty artifact repository and all seven exact confirmations; dry-run does not inspect the database |
| `qubu migrate reconcile <attempt-id> --outcome applied\|rolled_back --reason <text>`                | Runs application-owned verification, then records the explicit outcome                                                                      | Requires `verifyReconciliation` in config; no automatic inference                                              |
| `qubu schema bootstrap [--approve <operation-id=reason>...] [--dry-run]`                            | Plans an empty SQLite or PostgreSQL snapshot through diff/plan/program; executes through the normal executor unless dry-run                 | Rejects other dialects; unsafe or incomplete facts still require exact approvals or custom programs            |

JSON output is stable, newline-terminated, recursively key-sorted, and redacts
credential-like keys and credentials or secrets embedded in URLs. Human output
is deliberately terse. Signals propagate through adapters; an abort exits 130.

| Exit | Meaning                                                                       |
| ---: | ----------------------------------------------------------------------------- |
|    0 | Success                                                                       |
|    2 | CLI usage or argument error                                                   |
|    3 | Artifact, repository, journal, or other validation failure                    |
|    4 | Policy or adapter-capability refusal                                          |
|    5 | Managed schema drift                                                          |
|    6 | Recovery or reconciliation required                                           |
|    7 | Adapter, concurrency, rollback, uncertain-outcome, or other execution failure |
|  130 | Aborted                                                                       |

## Status, drift, and bootstrap

Status compares managed physical schema facts against the embedded expected
snapshot. Logical IDs help reporting but do not prove equality. Objects not
owned by the managed snapshot are returned separately as `unmanagedObjects`;
Qubu journal objects are excluded by migration snapshot readers.

`schema bootstrap` is for a fresh SQLite database or a fresh PostgreSQL schema.
It produces the same reviewed plan, versioned program, sealed artifact, and
executor path as a migration. A complete PostgreSQL snapshot retains standalone
enums as authoritative objects; bootstrap creates each enum before a table that
uses it as a native column type. SQLite inline constraints are compiled into
table creation, while table rebuilds are explicit phases with copy/postcondition
checks. Session settings such as SQLite PRAGMAs remain in the application or
adapter setup.

Use the reviewed complete snapshot directly as the PostgreSQL target:

```bash
qubu schema bootstrap --dry-run --format json --non-interactive
```

The dry run prints the ordered phases without opening the adapter. Remove
`--dry-run` only after reviewing any operation IDs that require `--approve` or
an application-owned custom program. Bootstrap does not import or replay
Drizzle migration history.

## Baseline and cutover checklist

A baseline is a statement about the live database now, not a replay of its
history. Before supplying all seven confirmations, the operator must verify:

- `database-target`: the connection names the intended environment;
- `snapshot-source`: the reviewed snapshot is the intended source of truth;
- `zero-managed-drift`: strict inspection reports no managed mismatch;
- `backup-restore-ready`: backup and restore procedures are ready;
- `other-migrators-stopped`: no other migration runner can race the cutover;
- `application-compatible`: deployed code is compatible with the live schema;
- `legacy-history-cutover`: the team accepts the new baseline as the lineage start.

For example, repeat `--confirm` once per exact value. The CLI rejects missing
or unknown confirmation names even outside production; `environment` is
reported as context rather than used to weaken the policy.

```bash
qubu migrate baseline lotta-cutover \
  --confirm database-target \
  --confirm snapshot-source \
  --confirm zero-managed-drift \
  --confirm backup-restore-ready \
  --confirm other-migrators-stopped \
  --confirm application-compatible \
  --confirm legacy-history-cutover \
  --format json --non-interactive
```

After success, preserve the written baseline artifact with the repository. Its
sequence is zero, its parent is null, and later migrations extend its digest.
