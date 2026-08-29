import {
  canTransitionAttempt,
  migrationJournalFormat,
  migrationJournalVersion,
  type AppliedArtifactRecord,
  type JournalFailure,
  type JournalMetadata,
  type MigrationAttempt,
  type MigrationJournal,
  type PhaseCheckpoint,
  type ReconciliationRecord,
  type AttemptState,
} from "./index.ts"

export class InMemoryMigrationJournal implements MigrationJournal {
  #head: JournalMetadata["head"] = null
  #applied: AppliedArtifactRecord[] = []
  #attempts = new Map<string, MigrationAttempt>()
  #checkpoints = new Map<string, PhaseCheckpoint[]>()
  #reconciliations: ReconciliationRecord[] = []

  async readMetadata(): Promise<JournalMetadata> {
    return freeze({
      format: migrationJournalFormat,
      version: migrationJournalVersion,
      head: this.#head,
    })
  }
  async listApplied(): Promise<readonly AppliedArtifactRecord[]> {
    return freeze(this.#applied.map((item) => ({ ...item })))
  }
  async listAttempts(): Promise<readonly MigrationAttempt[]> {
    return freeze([...this.#attempts.values()].map((item) => ({ ...item })))
  }
  async listCheckpoints(attemptId: string): Promise<readonly PhaseCheckpoint[]> {
    return freeze((this.#checkpoints.get(attemptId) ?? []).map((item) => ({ ...item })))
  }
  async listReconciliations(): Promise<readonly ReconciliationRecord[]> {
    return freeze(this.#reconciliations.map((item) => ({ ...item })))
  }

  async createAttempt(attempt: MigrationAttempt): Promise<void> {
    if (this.#attempts.has(attempt.id) || attempt.state !== "started")
      throw new Error("Invalid or duplicate attempt")
    this.#attempts.set(attempt.id, freeze({ ...attempt }))
  }

  async transitionAttempt(id: string, state: AttemptState, error?: JournalFailure): Promise<void> {
    const current = this.#attempts.get(id)
    if (!current) throw new Error(`Unknown attempt ${id}`)
    if (!canTransitionAttempt(current.state, state))
      throw new Error(`Invalid attempt transition ${current.state} -> ${state}`)
    this.#attempts.set(
      id,
      freeze({
        ...current,
        state,
        updatedAt: new Date().toISOString(),
        ...(error ? { error: { ...error } } : {}),
      }),
    )
  }

  async checkpoint(checkpoint: PhaseCheckpoint): Promise<void> {
    if (!this.#attempts.has(checkpoint.attemptId))
      throw new Error(`Unknown attempt ${checkpoint.attemptId}`)
    const values = this.#checkpoints.get(checkpoint.attemptId) ?? []
    if (
      values.some(
        (item) =>
          item.phaseId === checkpoint.phaseId &&
          item.statementId === checkpoint.statementId &&
          item.status === checkpoint.status,
      )
    )
      throw new Error("Duplicate checkpoint")
    values.push(freeze({ ...checkpoint }))
    this.#checkpoints.set(checkpoint.attemptId, values)
  }

  async appendApplied(record: AppliedArtifactRecord): Promise<void> {
    if (
      this.#applied.some(
        (item) =>
          item.artifactId === record.artifactId || item.artifactDigest === record.artifactDigest,
      )
    )
      throw new Error("Applied records are immutable and unique")
    if (record.sequence !== this.#applied.length || record.parentArtifactDigest !== this.#head)
      throw new Error("Applied record does not extend journal head")
    this.#applied.push(freeze({ ...record }))
  }

  async compareAndSwapHead(
    expected: JournalMetadata["head"],
    next: NonNullable<JournalMetadata["head"]>,
  ): Promise<boolean> {
    if (this.#head !== expected) return false
    this.#head = next
    return true
  }

  async appendAppliedAndAdvanceHead(
    record: AppliedArtifactRecord,
    expected: JournalMetadata["head"],
  ): Promise<boolean> {
    if (this.#head !== expected) return false
    await this.appendApplied(record)
    this.#head = record.artifactDigest
    return true
  }

  async recordReconciliation(record: ReconciliationRecord): Promise<void> {
    if (this.#reconciliations.some((item) => item.attemptId === record.attemptId))
      throw new Error("Attempt already reconciled")
    this.#reconciliations.push(freeze({ ...record }))
  }
}

function freeze<T>(value: T): T {
  return Object.freeze(value)
}
