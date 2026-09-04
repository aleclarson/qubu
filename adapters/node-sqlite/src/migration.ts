import type { DatabaseSync, SQLInputValue } from "node:sqlite"

import { canonicalText, digestCanonical, isSha256Digest } from "@qubu/migrate/artifact"
import type { ProgramCondition, Sha256Digest, TaggedParameterValue } from "@qubu/migrate/artifact"
import type {
  AdapterFailureClassification,
  MigrationAdapter,
  MigrationAwaitBoundary,
  MigrationSession,
  MigrationSnapshotInspection,
} from "@qubu/migrate/executor"
import {
  canTransitionAttempt,
  migrationJournalFormat,
  migrationJournalVersion,
  type AppliedArtifactRecord,
  type AttemptState,
  type JournalFailure,
  type JournalMetadata,
  type MigrationAttempt,
  type MigrationJournal,
  type PhaseCheckpoint,
  type ReconciliationRecord,
} from "@qubu/migrate/journal"
import { evaluateMigrationPrecondition } from "@qubu/migrate/plan"
import type { SchemaSnapshot, SnapshotJsonValue } from "qubu/snapshot"

const prefix = "__qubu_migration_"
const metadataTable = `${prefix}metadata`
const appliedTable = `${prefix}applied`
const attemptsTable = `${prefix}attempts`
const checkpointsTable = `${prefix}checkpoints`
const reconciliationsTable = `${prefix}reconciliations`
const leaseTable = `${prefix}lease`

export interface NodeSqliteMigrationAdapterOptions {
  /** Return the strict managed snapshot, excluding objects with Qubu's reserved journal prefix. */
  readonly readSnapshot: (
    database: DatabaseSync,
    expected?: SchemaSnapshot,
  ) => Promise<SchemaSnapshot | Sha256Digest | MigrationSnapshotInspection>
  readonly leasePollMilliseconds?: number
}

export interface NodeSqliteMigrationAdapter extends MigrationAdapter {
  readonly database: DatabaseSync
}

/** Adapt one application-owned, pinned `node:sqlite` connection for migrations. */
export function nodeSqliteMigrationAdapter(
  database: DatabaseSync,
  options: NodeSqliteMigrationAdapterOptions,
): NodeSqliteMigrationAdapter {
  const poll = options.leasePollMilliseconds ?? 10

  if (!Number.isFinite(poll) || poll < 0) {
    throw new TypeError("leasePollMilliseconds must be a non-negative finite number")
  }
  return {
    database,
    async openMigrationSession(signal) {
      signal?.throwIfAborted()
      initializeJournal(database)
      return new NodeSqliteMigrationSession(database, options, poll)
    },
  }
}

class NodeSqliteMigrationSession implements MigrationSession {
  readonly capabilities = Object.freeze({
    dialect: "sqlite",
    session: "pinned",
    transactionalDdl: true,
    optionalTransactions: true,
    transactions: Object.freeze(["required", "optional"] as const),
    lease: true,
    leaseKind: "database",
    locks: Object.freeze(["none", "exclusive"] as const),
    journal: Object.freeze({
      storage: "database",
      compareAndSwapHead: true,
      atomicAppliedAndHead: true,
    }),
    parameters: Object.freeze([
      "null",
      "boolean",
      "string",
      "number",
      "bigint",
      "bytes",
      "json",
    ] as const),
    commitAmbiguity: "recovery-required",
    forbiddenPhases: "unsupported",
    features: Object.freeze(["tagged-parameters", "journal-head-cas"]),
  } as const)
  readonly journal: MigrationJournal
  readonly #token = crypto.randomUUID()
  #leased = false
  #transaction = false
  #closed = false
  #ddlLock = false
  #expectedSnapshot: SchemaSnapshot | undefined

  constructor(
    readonly database: DatabaseSync,
    readonly options: NodeSqliteMigrationAdapterOptions,
    readonly poll: number,
  ) {
    this.journal = new NodeSqliteMigrationJournal(database)
  }

  async acquireLease(signal?: AbortSignal): Promise<void> {
    this.#open()
    while (!this.#leased) {
      signal?.throwIfAborted()
      try {
        this.database
          .prepare(`INSERT INTO ${leaseTable} (singleton, owner) VALUES (1, ?)`)
          .run(this.#token)
        this.#leased = true
      } catch (error) {
        const owner = this.database
          .prepare(`SELECT owner FROM ${leaseTable} WHERE singleton = 1`)
          .get()?.owner

        if (owner === this.#token) {
          this.#leased = true
        } else if (typeof owner !== "string") {
          throw error
        } else {
          await delay(this.poll, signal)
        }
      }
    }
  }
  async releaseLease(): Promise<void> {
    if (!this.#leased) {
      return
    }
    this.database
      .prepare(`DELETE FROM ${leaseTable} WHERE singleton = 1 AND owner = ?`)
      .run(this.#token)
    this.#leased = false
  }
  async acquireDdlLock(requirement: "shared" | "exclusive"): Promise<void> {
    this.#open()
    if (requirement !== "exclusive" || this.#ddlLock) {
      throw new Error(`node:sqlite migration sessions do not support DDL lock ${requirement}`)
    }
    this.#ddlLock = true
  }
  async releaseDdlLock(requirement: "shared" | "exclusive"): Promise<void> {
    if (requirement !== "exclusive" || !this.#ddlLock) {
      throw new Error(`node:sqlite migration session does not hold DDL lock ${requirement}`)
    }
    this.#ddlLock = false
  }
  async beginTransaction(): Promise<void> {
    this.#open()
    if (this.#transaction) {
      throw new Error("A migration transaction is already active")
    }
    this.database.exec("BEGIN IMMEDIATE")
    this.#transaction = true
  }
  async commitTransaction(): Promise<void> {
    this.#requiredTransaction()
    try {
      this.database.exec("COMMIT")
    } finally {
      this.#transaction = false
    }
  }
  async rollbackTransaction(): Promise<void> {
    this.#requiredTransaction()
    try {
      this.database.exec("ROLLBACK")
    } finally {
      this.#transaction = false
    }
  }
  async execute(sql: string, parameters: readonly TaggedParameterValue[]): Promise<void> {
    this.#open()
    this.database.prepare(sql).run(...parameters.map(decodeParameter))
  }
  async checkCondition(condition: ProgramCondition): Promise<boolean> {
    if (condition.type === "snapshot-fingerprint") {
      const { snapshot } = await this.readSnapshot(this.#expectedSnapshot)
      return evaluateMigrationPrecondition(snapshot, condition.value)
    }
    if (condition.type === "snapshot-digest") {
      return (
        isSha256Digest(condition.value) && (await this.currentSnapshotDigest()) === condition.value
      )
    }
    if (condition.type === "statement") {
      if (typeof condition.value !== "string") {
        return false
      }
      const row = this.database.prepare(condition.value).get()

      return truthy(row?.[Object.keys(row ?? {})[0]!])
    }

    if (
      condition.type === "object-present" ||
      condition.type === "object-absent" ||
      condition.type === "property-equals"
    ) {
      const { snapshot } = await this.readSnapshot(this.#expectedSnapshot)
      return evaluateMigrationPrecondition(snapshot, condition.value)
    }
    return false
  }
  async readSnapshot(expected?: SchemaSnapshot): Promise<MigrationSnapshotInspection> {
    const value = await this.options.readSnapshot(this.database, expected)

    if (isSha256Digest(value)) {
      throw new TypeError("The configured snapshot reader returned only a digest")
    }
    return isInspection(value)
      ? value
      : {
          snapshot: value,
          unmanagedObjects: [],
        }
  }
  async currentSnapshotDigest(expected?: SchemaSnapshot): Promise<Sha256Digest> {
    if (expected !== undefined) this.#expectedSnapshot = expected
    const value = await this.options.readSnapshot(this.database, expected)

    if (isSha256Digest(value)) {
      return value
    }
    return digestCanonical(
      "schema-snapshot",
      (isInspection(value) ? value.snapshot : value) as unknown as SnapshotJsonValue,
    )
  }
  async close(): Promise<void> {
    if (this.#closed) {
      return
    }
    let failure: unknown

    if (this.#transaction) {
      try {
        await this.rollbackTransaction()
      } catch (error) {
        failure = error
      }
    }
    if (this.#leased) {
      try {
        await this.releaseLease()
      } catch (error) {
        failure ??= error
      }
    }
    this.#closed = true
    if (failure) {
      throw failure
    }
  }
  classifyFailure(error: unknown, boundary: MigrationAwaitBoundary): AdapterFailureClassification {
    if (boundary === "commit-transaction" || boundary === "rollback-transaction") {
      return "uncertain"
    }
    if (boundary === "execute-statement") {
      const code = failureCode(error)

      return code?.startsWith("ERR_SQLITE_") || code?.startsWith("SQLITE_")
        ? "definite-failure"
        : "uncertain"
    }

    return "before-execution"
  }
  #requiredTransaction(): void {
    this.#open()
    if (!this.#transaction) {
      throw new Error("No migration transaction is active")
    }
  }
  #open(): void {
    if (this.#closed) {
      throw new Error("Migration session is closed")
    }
  }
}

class NodeSqliteMigrationJournal implements MigrationJournal {
  constructor(readonly database: DatabaseSync) {}
  async readMetadata(): Promise<JournalMetadata> {
    const row = this.database
      .prepare(`SELECT format, version, head FROM ${metadataTable} WHERE singleton = 1`)
      .get()

    if (!row) {
      throw new Error("Migration journal metadata is missing")
    }
    return {
      format: text(row.format) as typeof migrationJournalFormat,
      version: Number(row.version) as 1,
      head: nullableDigest(row.head),
    }
  }
  async listApplied(): Promise<readonly AppliedArtifactRecord[]> {
    return this.database
      .prepare(
        `SELECT artifact_id, sequence, artifact_digest, parent_artifact_digest, kind, attempt_id, applied_at FROM ${appliedTable} ORDER BY sequence`,
      )
      .all()
      .map((row) => ({
        artifactId: text(row.artifact_id),
        sequence: Number(row.sequence),
        artifactDigest: digest(row.artifact_digest),
        parentArtifactDigest: nullableDigest(row.parent_artifact_digest),
        kind: text(row.kind) as "migration" | "baseline",
        attemptId: text(row.attempt_id),
        appliedAt: text(row.applied_at),
      }))
  }
  async listAttempts(): Promise<readonly MigrationAttempt[]> {
    return this.database
      .prepare(
        `SELECT id, artifact_id, artifact_digest, expected_head, state, started_at, updated_at, error FROM ${attemptsTable} ORDER BY started_at, id`,
      )
      .all()
      .map((row) => ({
        id: text(row.id),
        artifactId: text(row.artifact_id),
        artifactDigest: digest(row.artifact_digest),
        expectedHead: nullableDigest(row.expected_head),
        state: text(row.state) as AttemptState,
        startedAt: text(row.started_at),
        updatedAt: text(row.updated_at),
        ...(row.error == null ? {} : { error: JSON.parse(text(row.error)) as JournalFailure }),
      }))
  }
  async listCheckpoints(attemptId: string): Promise<readonly PhaseCheckpoint[]> {
    return this.database
      .prepare(
        `SELECT attempt_id, phase_id, statement_id, status, recorded_at FROM ${checkpointsTable} WHERE attempt_id = ? ORDER BY rowid`,
      )
      .all(attemptId)
      .map((row) => ({
        attemptId: text(row.attempt_id),
        phaseId: text(row.phase_id),
        ...(row.statement_id == null ? {} : { statementId: text(row.statement_id) }),
        status: text(row.status) as "started" | "completed",
        recordedAt: text(row.recorded_at),
      }))
  }
  async listReconciliations(): Promise<readonly ReconciliationRecord[]> {
    return this.database
      .prepare(
        `SELECT attempt_id, outcome, reason, reconciled_at FROM ${reconciliationsTable} ORDER BY rowid`,
      )
      .all()
      .map((row) => ({
        attemptId: text(row.attempt_id),
        outcome: text(row.outcome) as "applied" | "rolled_back",
        reason: text(row.reason),
        reconciledAt: text(row.reconciled_at),
      }))
  }
  async createAttempt(value: MigrationAttempt): Promise<void> {
    if (value.state !== "started") {
      throw new Error("A new attempt must be started")
    }
    this.database
      .prepare(
        `INSERT INTO ${attemptsTable} (id, artifact_id, artifact_digest, expected_head, state, started_at, updated_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        value.id,
        value.artifactId,
        value.artifactDigest,
        value.expectedHead,
        value.state,
        value.startedAt,
        value.updatedAt,
      )
  }
  async transitionAttempt(id: string, state: AttemptState, error?: JournalFailure): Promise<void> {
    const current = this.database.prepare(`SELECT state FROM ${attemptsTable} WHERE id = ?`).get(id)

    if (!current || !canTransitionAttempt(text(current.state) as AttemptState, state)) {
      throw new Error("Invalid migration attempt transition")
    }
    const result = this.database
      .prepare(
        `UPDATE ${attemptsTable} SET state = ?, updated_at = ?, error = ? WHERE id = ? AND state = ?`,
      )
      .run(
        state,
        new Date().toISOString(),
        error ? canonicalText(error as unknown as SnapshotJsonValue).trimEnd() : null,
        id,
        current.state as SQLInputValue,
      )

    if (result.changes !== 1) {
      throw new Error("Migration attempt changed concurrently")
    }
  }
  async checkpoint(value: PhaseCheckpoint): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO ${checkpointsTable} (attempt_id, phase_id, statement_id, status, recorded_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        value.attemptId,
        value.phaseId,
        value.statementId ?? null,
        value.status,
        value.recordedAt,
      )
  }
  async appendApplied(value: AppliedArtifactRecord): Promise<void> {
    if ((await this.readMetadata()).head !== value.parentArtifactDigest) {
      throw new Error("Applied record does not extend journal head")
    }
    this.insertApplied(value)
  }
  async compareAndSwapHead(expected: Sha256Digest | null, next: Sha256Digest): Promise<boolean> {
    return (
      this.database
        .prepare(
          `UPDATE ${metadataTable} SET head = ? WHERE singleton = 1 AND ((head IS NULL AND ? IS NULL) OR head = ?)`,
        )
        .run(next, expected, expected).changes === 1
    )
  }
  async appendAppliedAndAdvanceHead(
    value: AppliedArtifactRecord,
    expected: Sha256Digest | null,
  ): Promise<boolean> {
    const owned = !this.database.isTransaction

    if (owned) {
      this.database.exec("BEGIN IMMEDIATE")
    }
    try {
      if (
        (await this.readMetadata()).head !== expected ||
        value.parentArtifactDigest !== expected
      ) {
        if (owned) {
          this.database.exec("ROLLBACK")
        }
        return false
      }

      this.insertApplied(value)
      if (!(await this.compareAndSwapHead(expected, value.artifactDigest))) {
        throw new Error("Journal head changed after applied history was appended")
      }
      if (owned) {
        this.database.exec("COMMIT")
      }
      return true
    } catch (error) {
      if (owned && this.database.isTransaction) {
        this.database.exec("ROLLBACK")
      }
      throw error
    }
  }
  async recordReconciliation(value: ReconciliationRecord): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO ${reconciliationsTable} (attempt_id, outcome, reason, reconciled_at) VALUES (?, ?, ?, ?)`,
      )
      .run(value.attemptId, value.outcome, value.reason, value.reconciledAt)
  }
  private insertApplied(value: AppliedArtifactRecord): void {
    this.database
      .prepare(
        `INSERT INTO ${appliedTable} (artifact_id, sequence, artifact_digest, parent_artifact_digest, kind, attempt_id, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.artifactId,
        value.sequence,
        value.artifactDigest,
        value.parentArtifactDigest,
        value.kind,
        value.attemptId,
        value.appliedAt,
      )
  }
}

function initializeJournal(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${metadataTable} (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), format TEXT NOT NULL, version INTEGER NOT NULL, head TEXT);
    CREATE TABLE IF NOT EXISTS ${appliedTable} (artifact_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE, artifact_digest TEXT NOT NULL UNIQUE, parent_artifact_digest TEXT, kind TEXT NOT NULL CHECK (kind IN ('migration', 'baseline')), attempt_id TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ${attemptsTable} (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, artifact_digest TEXT NOT NULL, expected_head TEXT, state TEXT NOT NULL CHECK (state IN ('started', 'running', 'applied', 'rolled_back', 'recovery_required')), started_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT);
    CREATE TABLE IF NOT EXISTS ${checkpointsTable} (attempt_id TEXT NOT NULL, phase_id TEXT NOT NULL, statement_id TEXT, status TEXT NOT NULL CHECK (status IN ('started', 'completed')), recorded_at TEXT NOT NULL, UNIQUE (attempt_id, phase_id, statement_id, status));
    CREATE TABLE IF NOT EXISTS ${reconciliationsTable} (attempt_id TEXT PRIMARY KEY, outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'rolled_back')), reason TEXT NOT NULL, reconciled_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ${leaseTable} (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), owner TEXT NOT NULL);
    INSERT OR IGNORE INTO ${metadataTable} (singleton, format, version, head) VALUES (1, '${migrationJournalFormat}', ${migrationJournalVersion}, NULL);
  `)
}

function decodeParameter(value: TaggedParameterValue): SQLInputValue {
  switch (value.type) {
    case "null": {
      return null
    }
    case "boolean": {
      return value.value ? 1 : 0
    }
    case "string": {
      return value.value
    }
    case "number": {
      const number = Number(value.value)

      if (!Number.isFinite(number)) {
        throw new TypeError("Invalid tagged number")
      }
      return number
    }

    case "bigint": {
      return BigInt(value.value)
    }
    case "bytes": {
      return Uint8Array.from(atob(value.base64), (character) => character.charCodeAt(0))
    }
    case "json": {
      return canonicalText(value.value).trimEnd()
    }
  }
}

function text(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Invalid migration journal text")
  }
  return value
}

function digest(value: unknown): Sha256Digest {
  if (!isSha256Digest(value)) {
    throw new Error("Invalid migration journal digest")
  }
  return value
}

function nullableDigest(value: unknown): Sha256Digest | null {
  return value == null ? null : digest(value)
}

function isInspection(value: unknown): value is MigrationSnapshotInspection {
  return (
    value !== null &&
    typeof value === "object" &&
    "snapshot" in value &&
    "unmanagedObjects" in value
  )
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === 1n || value === "1"
}

function failureCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
