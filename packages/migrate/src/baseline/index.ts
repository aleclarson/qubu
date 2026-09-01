import { diffSnapshots, type SnapshotDiffDiagnostic, type SnapshotDiffOperation } from "qubu/diff"
import type { SchemaSnapshot, SnapshotJsonValue } from "qubu/snapshot"

import {
  sealBaselineArtifact,
  type ArtifactConstraints,
  type ArtifactProvenance,
  type VerifiedBaselineArtifact,
} from "../artifact/index.ts"
import { MigrationExecutionError } from "../executor/errors.ts"
import type { MigrationAdapter, MigrationSession, MigrationSnapshot } from "../executor/types.ts"
import { validateJournalState } from "../journal/index.ts"

export interface BaselineConfirmation {
  readonly databaseTargetVerified: true
  readonly snapshotSourceVerified: true
  readonly zeroManagedDriftVerified: true
  readonly backupRestoreReady: true
  readonly otherMigratorsStopped: true
  readonly applicationCompatible: true
  readonly legacyHistoryCutoverAccepted: true
}

export interface CreateBaselineInput {
  readonly adapter: MigrationAdapter
  readonly id: string
  readonly snapshot: MigrationSnapshot
  readonly provenance: ArtifactProvenance
  readonly confirmation: BaselineConfirmation
  readonly operator?: SnapshotJsonValue
  readonly constraints?: ArtifactConstraints
  readonly verifiedAt?: string
  readonly attemptId?: string
  readonly signal?: AbortSignal
}

export interface BaselineResult {
  readonly artifact: VerifiedBaselineArtifact
  readonly unmanagedObjects: readonly { readonly kind: string; readonly physicalName: string }[]
}

/** Verify and atomically record the first, non-executable artifact in an empty journal. */
export async function createBaseline(input: CreateBaselineInput): Promise<BaselineResult> {
  input.signal?.throwIfAborted()
  let session: MigrationSession | undefined
  let leased = false
  try {
    session = await input.adapter.openMigrationSession(input.signal)
    if (session.capabilities.dialect !== input.snapshot.dialect.name)
      throw new MigrationExecutionError(
        "capability",
        "Baseline dialect is incompatible",
        {},
        { retry: "safe" },
      )
    if (!session.readSnapshot)
      throw new MigrationExecutionError(
        "capability",
        "Adapter does not support strict snapshot inspection",
        {},
        { retry: "safe" },
      )
    await session.acquireLease(input.signal)
    leased = true
    const [metadata, applied, attempts] = await Promise.all([
      session.journal.readMetadata(),
      session.journal.listApplied(),
      session.journal.listAttempts(),
    ])
    if (
      validateJournalState(metadata, applied, attempts).length ||
      applied.length ||
      attempts.length ||
      metadata.head
    )
      throw new MigrationExecutionError(
        "policy",
        "A baseline requires an empty migration journal",
        {},
        { retry: "safe" },
      )

    const inspection = await session.readSnapshot(input.snapshot)
    const comparison = compareManagedSnapshots(input.snapshot, inspection.snapshot)
    if (!comparison.matches)
      throw new MigrationExecutionError(
        "drift",
        "Live managed schema does not match the baseline snapshot",
        {},
        { retry: "safe" },
      )

    const verifiedAt = input.verifiedAt ?? new Date().toISOString()
    const artifact = await sealBaselineArtifact({
      format: "qubu-verified-baseline",
      version: 1,
      id: input.id,
      sequence: 0,
      parentArtifactDigest: null,
      dialect: input.snapshot.dialect,
      ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
      snapshot: { value: input.snapshot },
      verifiedAt,
      provenance: input.provenance,
      operator: {
        confirmation: {
          databaseTargetVerified: input.confirmation.databaseTargetVerified,
          snapshotSourceVerified: input.confirmation.snapshotSourceVerified,
          zeroManagedDriftVerified: input.confirmation.zeroManagedDriftVerified,
          backupRestoreReady: input.confirmation.backupRestoreReady,
          otherMigratorsStopped: input.confirmation.otherMigratorsStopped,
          applicationCompatible: input.confirmation.applicationCompatible,
          legacyHistoryCutoverAccepted: input.confirmation.legacyHistoryCutoverAccepted,
        },
        ...(input.operator === undefined ? {} : { metadata: input.operator }),
      },
    })
    const attemptId = input.attemptId ?? `baseline-${crypto.randomUUID()}`
    await session.journal.createAttempt({
      id: attemptId,
      artifactId: artifact.id,
      artifactDigest: artifact.artifactDigest,
      expectedHead: null,
      state: "started",
      startedAt: verifiedAt,
      updatedAt: verifiedAt,
    })
    await session.beginTransaction()
    try {
      await session.journal.transitionAttempt(attemptId, "running")
      const advanced = await session.journal.appendAppliedAndAdvanceHead(
        {
          artifactId: artifact.id,
          sequence: 0,
          artifactDigest: artifact.artifactDigest,
          parentArtifactDigest: null,
          kind: "baseline",
          attemptId,
          appliedAt: verifiedAt,
        },
        null,
      )
      if (!advanced) throw new Error("Migration journal head changed during baseline creation")
      await session.journal.transitionAttempt(attemptId, "applied")
      await session.commitTransaction()
    } catch (error) {
      await session.rollbackTransaction().catch(() => undefined)
      await session.journal.transitionAttempt(attemptId, "rolled_back", {
        code: "baseline-failed",
        message: error instanceof Error ? error.message : "Baseline transaction failed",
      })
      throw error
    }
    return Object.freeze({ artifact, unmanagedObjects: inspection.unmanagedObjects })
  } finally {
    if (session && leased) await session.releaseLease()
    if (session) await session.close()
  }
}

export interface ManagedSnapshotComparison {
  readonly matches: boolean
  readonly operations: readonly SnapshotDiffOperation[]
  readonly diagnostics: readonly SnapshotDiffDiagnostic[]
}

/** Logical IDs are retained for reporting, but equality is decided from resolved physical facts. */
export function compareManagedSnapshots(
  expected: MigrationSnapshot,
  actual: MigrationSnapshot,
): ManagedSnapshotComparison {
  const result = diffSnapshots(expected, actual)
  const matches =
    expected.version === 1 && actual.version === 1
      ? JSON.stringify(physicalProjection(expected)) === JSON.stringify(physicalProjection(actual))
      : result.equal
  return Object.freeze({
    matches,
    operations: result.operations,
    diagnostics: result.diagnostics,
  })
}

function physicalProjection(snapshot: SchemaSnapshot): unknown {
  const tables = new Map(snapshot.tables.map((table) => [table.id, table.physicalName]))
  return snapshot.tables
    .map((table) => {
      const columns = new Map(table.columns.map((column) => [column.id, column.physicalName]))
      return {
        physicalName: table.physicalName,
        columns: table.columns
          .map((column) => ({
            physicalName: column.physicalName,
            nullable: column.nullable,
            storage: physicalStorageType(snapshot.dialect.name, column.storage),
            default: column.default,
            generatedColumn: column.generatedColumn,
            identity:
              column.identity === undefined
                ? undefined
                : {
                    generation: column.identity.generation,
                    autoIncrement:
                      column.identity.dialect?.dialect === "sqlite" &&
                      isRecord(column.identity.dialect.data) &&
                      column.identity.dialect.data.autoIncrement === true,
                  },
            onUpdate: column.onUpdate,
          }))
          .sort(byPhysicalName),
        constraints: table.constraints
          .map((constraint) => ({
            kind: constraint.kind,
            physicalName: constraint.physicalName,
            ...("columns" in constraint
              ? { columns: constraint.columns.map((id) => columns.get(id) ?? id) }
              : {}),
            ...(constraint.kind === "foreign-key"
              ? {
                  target: {
                    table: tables.get(constraint.target.table) ?? constraint.target.table,
                    columns: constraint.target.columns,
                  },
                  onUpdate: constraint.onUpdate ?? "no-action",
                  onDelete: constraint.onDelete ?? "no-action",
                  match: constraint.match ?? "simple",
                }
              : {}),
            ...(constraint.kind === "check" ? { expression: constraint.expression.sql } : {}),
          }))
          .sort(byPhysicalName),
        indexes: table.indexes
          .map((index) => ({
            physicalName: index.physicalName,
            terms: index.terms,
            unique: index.unique,
            predicate: index.predicate?.sql,
          }))
          .sort(byPhysicalName),
      }
    })
    .sort(byPhysicalName)
}

function physicalStorageType(
  dialect: string,
  storage: SchemaSnapshot["tables"][number]["columns"][number]["storage"],
): string | undefined {
  if (!storage) return undefined
  if (storage.kind === "native") return storage.type.trim().toUpperCase()
  if (dialect === "sqlite") {
    return (
      (
        {
          integer: "INTEGER",
          numeric: "NUMERIC",
          text: "TEXT",
          boolean: "INTEGER",
          date: "TEXT",
          timestamp: "TEXT",
          uuid: "TEXT",
          json: "TEXT",
          bigint: "INTEGER",
          binary: "BLOB",
        } as Record<string, string>
      )[storage.type.toLowerCase()] ?? storage.type.toUpperCase()
    )
  }
  return storage.type.toUpperCase()
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function byPhysicalName(
  left: { readonly physicalName: string },
  right: { readonly physicalName: string },
): number {
  return left.physicalName.localeCompare(right.physicalName)
}
