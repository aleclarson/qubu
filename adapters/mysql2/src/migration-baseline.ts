import { encodeBaselineArtifact, sealBaselineArtifact } from "@qubu/migrate/artifact"
import {
  compareManagedSnapshots,
  type BaselineResult,
  type CreateBaselineInput as SharedCreateBaselineInput,
} from "@qubu/migrate/baseline"
import { MigrationExecutionError, type MigrationSnapshotInspection } from "@qubu/migrate/executor"
import { assertSchemaSnapshot, encodeSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"

import {
  initializeHistory,
  readCompletedIds,
  validateMigrationId,
  type MigrationConnection,
} from "./migration-history.ts"
import { readMigrationSnapshot, selectedNamespace } from "./migration-snapshot.ts"
import type { Mysql2Migration } from "./migration.ts"

/** Original managed scope, including desired tables that may not exist yet. */
export interface CaptureBaselineInput {
  readonly scope: SchemaSnapshot
  readonly signal?: AbortSignal
}

/** Reviewed candidate and the empty SQL migration list that will follow its acceptance. */
export interface VerifyBaselineInput extends CaptureBaselineInput {
  readonly candidate: SchemaSnapshot
  readonly migrations: readonly Mysql2Migration[]
}

/** Acceptance metadata for MySQL's basic SQL migration history. */
export interface CreateBaselineInput
  extends
    VerifyBaselineInput,
    Pick<
      SharedCreateBaselineInput,
      "id" | "provenance" | "confirmation" | "operator" | "verifiedAt"
    > {}

/**
 * Capture actual managed facts without changing application schema/data or recording history.
 * Initializes the basic runner's history table. Use autocommit with no active transaction. Keep the
 * original scope through acceptance and prevent concurrent migrations/DDL; this basic runner has no
 * database lease.
 */
export async function captureBaseline(
  connection: MigrationConnection,
  input: CaptureBaselineInput,
): Promise<MigrationSnapshotInspection> {
  input.signal?.throwIfAborted()
  assertSchemaSnapshot(input.scope)
  await selectedNamespace(connection, input.scope, input.signal)
  // Initialize before capture because MySQL's catalog includes collations used by journal columns.
  await initializeHistory(connection)
  return readMigrationSnapshot(connection, input.scope, input.signal)
}

/** Reinspect the original scope; require empty history and exact canonical candidate equality. */
export async function preflightBaseline(
  connection: MigrationConnection,
  input: VerifyBaselineInput,
): Promise<MigrationSnapshotInspection> {
  input.signal?.throwIfAborted()
  assertSchemaSnapshot(input.scope)
  assertSchemaSnapshot(input.candidate)
  const names = new Set(input.scope.tables.map((table) => table.physicalName))

  if (input.candidate.tables.some((table) => !names.has(table.physicalName))) {
    throw new MigrationExecutionError(
      "policy",
      "Candidate contains tables outside the configured managed scope",
    )
  }

  if (input.migrations.length) {
    throw new MigrationExecutionError("policy", "A baseline requires an empty SQL migration list")
  }

  const inspection = await captureBaseline(connection, input)

  if ((await readCompletedIds(connection)).size) {
    throw new MigrationExecutionError("policy", "A baseline requires empty MySQL migration history")
  }

  if (encodeSchemaSnapshot(input.candidate) !== encodeSchemaSnapshot(inspection.snapshot)) {
    throw new MigrationExecutionError(
      "drift",
      "Live managed schema differs from the reviewed candidate; recapture and review before accepting",
      {},
      {
        retry: "safe",
        details: {
          comparison: compareManagedSnapshots(input.candidate, inspection.snapshot),
          actualSnapshot: inspection.snapshot,
          unmanagedObjects: inspection.unmanagedObjects,
        },
      },
    )
  }

  return inspection
}

/**
 * Repeat preflight and record the reviewed baseline in one autocommitted history insert. Requires
 * the same seven acknowledgments as shared adoption. The caller must serialize runners, prevent
 * DDL, and keep autocommit enabled. A lost insert response has an uncertain outcome; inspect
 * history before retrying. No application SQL is executed. Persist the returned artifact as review
 * evidence; subsequent migrations use migrate(), not the shared artifact executor.
 */
export async function createBaseline(
  connection: MigrationConnection,
  input: CreateBaselineInput,
): Promise<BaselineResult> {
  validateMigrationId(input.id)
  const facts: readonly (keyof CreateBaselineInput["confirmation"])[] = [
    "databaseTargetVerified",
    "snapshotSourceVerified",
    "zeroManagedDriftVerified",
    "backupRestoreReady",
    "otherMigratorsStopped",
    "incompatibleApplicationPrevented",
    "legacyHistoryCutoverAccepted",
  ]

  if (facts.some((fact) => input.confirmation?.[fact] !== true)) {
    throw new MigrationExecutionError(
      "policy",
      "Baseline requires all seven exact confirmation facts",
    )
  }

  const inspection = await preflightBaseline(connection, input)
  const verifiedAt = input.verifiedAt ?? new Date().toISOString()
  const artifact = await sealBaselineArtifact({
    format: "qubu-verified-baseline",
    version: 1,
    id: input.id,
    sequence: 0,
    parentArtifactDigest: null,
    dialect: input.candidate.dialect,
    snapshot: { value: input.candidate },
    verifiedAt,
    provenance: input.provenance,
    operator: {
      confirmation: Object.fromEntries(facts.map((fact) => [fact, input.confirmation[fact]])),
      ...(input.operator === undefined ? {} : { metadata: input.operator }),
    },
  })

  input.signal?.throwIfAborted()
  await connection.execute({
    sql: "INSERT INTO __qubu_mysql2_migrations (id, hash, created_at, baseline) VALUES (?, ?, ?, ?)",
    values: [
      artifact.id,
      artifact.artifactDigest.slice("sha256:".length),
      Date.parse(verifiedAt),
      encodeBaselineArtifact(artifact),
    ],
    rowsAsArray: false,
    nestTables: false,
  })
  return {
    artifact,
    unmanagedObjects: inspection.unmanagedObjects,
  }
}
