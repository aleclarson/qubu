import type { Sha256Digest } from "../artifact/index.ts"

export const migrationJournalFormat = "qubu-migration-journal" as const
export const migrationJournalVersion = 1 as const

export type AttemptState = "started" | "running" | "applied" | "rolled_back" | "recovery_required"

export interface JournalMetadata {
  readonly format: typeof migrationJournalFormat
  readonly version: typeof migrationJournalVersion
  readonly head: Sha256Digest | null
}

export interface AppliedArtifactRecord {
  readonly artifactId: string
  readonly sequence: number
  readonly artifactDigest: Sha256Digest
  readonly parentArtifactDigest: Sha256Digest | null
  readonly kind: "migration" | "baseline"
  readonly attemptId: string
  readonly appliedAt: string
}

export interface MigrationAttempt {
  readonly id: string
  readonly artifactId: string
  readonly artifactDigest: Sha256Digest
  readonly expectedHead: Sha256Digest | null
  readonly state: AttemptState
  readonly startedAt: string
  readonly updatedAt: string
  readonly error?: JournalFailure
}

export interface PhaseCheckpoint {
  readonly attemptId: string
  readonly phaseId: string
  readonly statementId?: string
  readonly status: "started" | "completed"
  readonly recordedAt: string
}

export interface ReconciliationRecord {
  readonly attemptId: string
  readonly outcome: "applied" | "rolled_back"
  readonly reason: string
  readonly reconciledAt: string
}

/** Persisted failures contain safe metadata only, never SQL parameters or credentials. */
export interface JournalFailure {
  readonly code: string
  readonly message: string
  readonly phaseId?: string
  readonly statementId?: string
}

/** Storage-neutral journal operations. Implementations must reject invalid transitions. */
export interface MigrationJournal {
  readMetadata(): Promise<JournalMetadata>
  listApplied(): Promise<readonly AppliedArtifactRecord[]>
  listAttempts(): Promise<readonly MigrationAttempt[]>
  listCheckpoints(attemptId: string): Promise<readonly PhaseCheckpoint[]>
  listReconciliations(): Promise<readonly ReconciliationRecord[]>
  createAttempt(attempt: MigrationAttempt): Promise<void>
  transitionAttempt(id: string, state: AttemptState, error?: JournalFailure): Promise<void>
  checkpoint(checkpoint: PhaseCheckpoint): Promise<void>
  appendApplied(record: AppliedArtifactRecord): Promise<void>
  compareAndSwapHead(expected: Sha256Digest | null, next: Sha256Digest): Promise<boolean>
  /** Atomically append immutable history and compare-and-swap its head. */
  appendAppliedAndAdvanceHead(
    record: AppliedArtifactRecord,
    expected: Sha256Digest | null,
  ): Promise<boolean>
  recordReconciliation(record: ReconciliationRecord): Promise<void>
}

export type JournalDiagnosticCode =
  | "journal-format"
  | "journal-version"
  | "journal-corrupt"
  | "journal-head-mismatch"
  | "journal-not-prefix"
  | "recovery-required"

export interface JournalDiagnostic {
  readonly code: JournalDiagnosticCode
  readonly message: string
  readonly path: readonly (string | number)[]
}

export function validateJournalState(
  metadata: JournalMetadata,
  applied: readonly AppliedArtifactRecord[],
  attempts: readonly MigrationAttempt[],
): readonly JournalDiagnostic[] {
  const diagnostics: JournalDiagnostic[] = []
  if (metadata.format !== migrationJournalFormat) {
    diagnostics.push(diag("journal-format", ["metadata", "format"], "Unsupported journal format"))
  }
  if (metadata.version !== migrationJournalVersion) {
    diagnostics.push(
      diag("journal-version", ["metadata", "version"], "Unsupported journal version"),
    )
  }

  const ids = new Set<string>()
  const digests = new Set<string>()
  for (let index = 0; index < applied.length; index++) {
    const record = applied[index]!
    if (record.sequence !== index)
      diagnostics.push(
        diag("journal-corrupt", ["applied", index, "sequence"], `Expected sequence ${index}`),
      )
    if (ids.has(record.artifactId) || digests.has(record.artifactDigest))
      diagnostics.push(
        diag("journal-corrupt", ["applied", index], "Duplicate immutable applied record"),
      )
    ids.add(record.artifactId)
    digests.add(record.artifactDigest)
    const expectedParent = index === 0 ? null : applied[index - 1]!.artifactDigest
    if (record.parentArtifactDigest !== expectedParent)
      diagnostics.push(
        diag(
          "journal-corrupt",
          ["applied", index, "parentArtifactDigest"],
          "Applied history is not a linear chain",
        ),
      )
  }
  const expectedHead = applied.at(-1)?.artifactDigest ?? null
  if (metadata.head !== expectedHead)
    diagnostics.push(
      diag(
        "journal-head-mismatch",
        ["metadata", "head"],
        "Journal head does not match immutable history",
      ),
    )

  const attemptIds = new Set<string>()
  const attemptsById = new Map<string, MigrationAttempt>()
  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index]!
    if (attemptIds.has(attempt.id))
      diagnostics.push(diag("journal-corrupt", ["attempts", index, "id"], "Duplicate attempt ID"))
    attemptIds.add(attempt.id)
    attemptsById.set(attempt.id, attempt)
    if (attempt.state === "applied" && !applied.some((record) => record.attemptId === attempt.id)) {
      diagnostics.push(
        diag(
          "journal-corrupt",
          ["attempts", index, "state"],
          "Applied attempt has no immutable history record",
        ),
      )
    }
    if (
      attempt.state === "started" ||
      attempt.state === "running" ||
      attempt.state === "recovery_required"
    ) {
      diagnostics.push(
        diag(
          "recovery-required",
          ["attempts", index, "state"],
          `Attempt ${attempt.id} must be reconciled`,
        ),
      )
    }
  }
  for (let index = 0; index < applied.length; index++) {
    const record = applied[index]!
    const attempt = attemptsById.get(record.attemptId)
    if (
      !attempt ||
      attempt.artifactId !== record.artifactId ||
      attempt.artifactDigest !== record.artifactDigest
    ) {
      diagnostics.push(
        diag(
          "journal-corrupt",
          ["applied", index, "attemptId"],
          "Applied record does not match its attempt",
        ),
      )
    }
  }
  return Object.freeze(diagnostics)
}

const transitions: Readonly<Record<AttemptState, readonly AttemptState[]>> = {
  started: ["running", "rolled_back", "recovery_required"],
  running: ["applied", "rolled_back", "recovery_required"],
  applied: [],
  rolled_back: [],
  recovery_required: ["applied", "rolled_back"],
}

export function canTransitionAttempt(from: AttemptState, to: AttemptState): boolean {
  return transitions[from].includes(to)
}

function diag(
  code: JournalDiagnosticCode,
  path: readonly (string | number)[],
  message: string,
): JournalDiagnostic {
  return Object.freeze({ code, path: Object.freeze([...path]), message })
}
