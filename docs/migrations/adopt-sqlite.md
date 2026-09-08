# Adopt an existing SQLite database

> Capture and accept the live schema as migration history's starting point, then
> reconcile it with the application's desired schema separately.

Configure the [CLI](operations.md#configuration) with the existing database
connection, desired application snapshot, and an empty artifact directory. Use
an adapter with strict snapshot inspection, such as
`@qubu/adapter-libsql/migration`.

If the live `game` table lacks `manifest`, the captured baseline must also lack
`manifest`. Adoption does not add that column or certify that the desired
application version can run. Keep incompatible code from running until a
separate reviewed migration reconciles the schema.

## Capture and review

Capture the actual managed schema to a new file outside the artifact directory:

```bash
qubu migrate baseline-capture --out ./baseline-candidate.json \
  --config ./qubu.config.js --format json
```

The candidate is an ordinary Snapshot v1 JSON file, not a migration artifact.
Capture refuses to overwrite an existing file. The output reports the config
path, environment, dialect, namespace, configured managed tables, included
live tables, and unmanaged objects. These connection selectors help you review
the target; they do not prove database identity. Verify the configured
connection independently without putting credentials into the candidate or
operator metadata.

For libSQL, the existing selection policy includes tables named by the configured
snapshot and reports other tables as unmanaged. Qubu's reserved
`__qubu_migration_` objects are excluded. Non-table catalog objects retain the
adapter's existing inspection policy; strict inspection may reject unsupported
facts even outside the selected tables.

Review the candidate's columns, defaults, constraints, indexes, and dialect
facts along with the reported scope and exclusions. Keep the same connection,
configuration, adapter, and managed scope through acceptance, including tables
that are currently absent. The ordinary snapshot format does not bind a
candidate to a particular database or persist that original selection.

Capture and preflight create no baseline, migration attempts, or application
schema/data changes. Opening a migration session may initialize Qubu journal
tables and perform lease bookkeeping. Stop other migrators and prevent concurrent
DDL during cutover; the migrator lease coordinates participating Qubu runners.

## Preflight the reviewed candidate

Run a fresh inspection against the explicitly selected file:

```bash
qubu migrate baseline initial --candidate ./baseline-candidate.json \
  --config ./qubu.config.js --dry-run --format json
```

Preflight checks that the artifact repository and migration journal have empty
history, then rereads the original configured scope under the migrator lease.
It records no baseline and requires no acceptance confirmations.

The reread must equal the reviewed candidate's canonical snapshot, including
SQLite-specific facts. A changed column, newly appeared managed table, or changed
dialect metadata blocks acceptance. Even nonphysical snapshot metadata differences
require recapture; this check intentionally accepts only identical evidence. Failures include comparison operations,
diagnostics, and the actual snapshot when comparison was possible. Strict
inspection failures also block acceptance. Investigate differences, capture a
new candidate, and review it again; do not edit expected facts into the file to
hide missing live facts.

## Accept the candidate

Before acceptance, verify all seven acknowledgments:

| Confirmation                         | What the operator verifies                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `database-target`                    | The configured connection targets the intended database and environment.                        |
| `snapshot-source`                    | The explicitly selected candidate was captured and reviewed using this unchanged managed scope. |
| `zero-managed-drift`                 | Fresh strict inspection has zero differences from that reviewed candidate.                      |
| `backup-restore-ready`               | Backup and restore procedures are ready.                                                        |
| `other-migrators-stopped`            | Other migration runners are stopped and concurrent DDL is prevented.                            |
| `incompatible-application-prevented` | Incompatible application code will remain stopped until schema reconciliation is complete.      |
| `legacy-history-cutover`             | The team accepts this baseline as the new lineage start.                                        |

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

Acceptance repeats preflight before recording. The accepted snapshot becomes
sequence zero with a null parent and no executable program. Preserve the written
baseline artifact with the repository. The journal is recorded before the CLI
writes the artifact file; if file writing fails, stop and investigate the journal
and repository state rather than rerunning baseline creation against nonempty
history.

## Plan reconciliation separately

Keep `config.snapshot` as the application's desired schema. Generate the next
migration from the accepted baseline:

```bash
qubu migrate create add-manifest --dry-run --format json
```

The existing creation workflow uses the recorded baseline's embedded snapshot
as its source, so the missing column remains a real difference. Review required
operation approvals or custom programs, create the migration artifact, and apply
it through the [normal workflow](operations.md). Constraint names or default
representations may still produce differences during planning. Adoption does
not provide general SQL equivalence detection or automatic repairs.

## Use the migration API

Use `captureBaseline({ adapter, scope })` and serialize its returned `snapshot`
with `encodeSchemaSnapshot`. Reload and review that file before passing it as
`candidate` to `preflightBaseline` or `createBaseline`. Both verification APIs
also require `scope` and `repository`; reuse the original configured scope,
not the candidate's list of present tables.

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

`createBaseline` additionally takes the artifact ID, provenance, and all seven
`BaselineConfirmation` facts. It returns the artifact for the caller to persist.
Acceptance's application acknowledgment is `incompatibleApplicationPrevented`;
it does not assert that desired application code is already compatible.
