import { canonicalText, digestCanonical, isSha256Digest } from "@qubu/migrate/artifact"
import type { ProgramCondition, Sha256Digest, TaggedParameterValue } from "@qubu/migrate/artifact"
import type {
  AdapterFailureClassification,
  MigrationAdapter,
  MigrationAwaitBoundary,
  MigrationSession,
  MigrationSnapshot,
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
import type { SnapshotJsonValue } from "qubu/snapshot"

export interface PostgresMigrationResult {
  readonly rows: readonly Record<string, unknown>[]
  readonly affectedRows?: number
}
export interface PostgresMigrationConnection {
  query(sql: string, parameters?: readonly unknown[]): Promise<PostgresMigrationResult>
  close?(): Promise<void>
}
export interface PostgresMigrationAdapterOptions {
  readonly openConnection: (signal?: AbortSignal) => Promise<PostgresMigrationConnection>
  readonly readSnapshot: (
    connection: PostgresMigrationConnection,
    expected?: MigrationSnapshot,
  ) => Promise<MigrationSnapshot | Sha256Digest | MigrationSnapshotInspection>
  readonly serverVersion?: string
  readonly leasePollMilliseconds?: number
}

/** Driver-neutral PostgreSQL mechanics used by the pg, postgres.js, and PGlite entrypoints. */
export function postgresMigrationAdapter(
  options: PostgresMigrationAdapterOptions,
): MigrationAdapter {
  const poll = options.leasePollMilliseconds ?? 10

  if (!Number.isFinite(poll) || poll < 0) {
    throw new TypeError("leasePollMilliseconds must be a non-negative finite number")
  }
  return {
    async openMigrationSession(signal) {
      signal?.throwIfAborted()
      const connection = await options.openConnection(signal)

      try {
        await initializeJournal(connection)
        return new PostgresMigrationSession(connection, options, poll)
      } catch (error) {
        await connection.close?.()
        throw error
      }
    },
  }
}

class PostgresMigrationSession implements MigrationSession {
  readonly capabilities
  readonly journal: MigrationJournal
  #leased = false
  #transaction = false
  #closed = false
  #ddlLock = false
  constructor(
    readonly connection: PostgresMigrationConnection,
    readonly options: PostgresMigrationAdapterOptions,
    readonly poll: number,
  ) {
    this.capabilities = Object.freeze({
      dialect: "postgresql",
      ...(options.serverVersion ? { serverVersion: options.serverVersion } : {}),
      session: "pinned" as const,
      transactionalDdl: true,
      optionalTransactions: true,
      transactions: Object.freeze(["required", "optional", "forbidden"] as const),
      lease: true,
      leaseKind: "database" as const,
      locks: Object.freeze(["none", "exclusive"] as const),
      journal: Object.freeze({
        storage: "database" as const,
        compareAndSwapHead: true as const,
        atomicAppliedAndHead: true as const,
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
      commitAmbiguity: "recovery-required" as const,
      forbiddenPhases: "checkpointed" as const,
      features: Object.freeze(["tagged-parameters", "journal-head-cas", "forbidden-phases"]),
    })
    this.journal = new PostgresMigrationJournal(connection, () => this.#transaction)
  }
  async acquireLease(signal?: AbortSignal): Promise<void> {
    while (!this.#leased) {
      signal?.throwIfAborted()
      const result = await this.connection.query(
        "SELECT pg_try_advisory_lock(707518210001) AS acquired",
      )

      this.#leased = result.rows[0]?.acquired === true
      if (!this.#leased) {
        await delay(this.poll, signal)
      }
    }
  }
  async releaseLease(): Promise<void> {
    if (!this.#leased) {
      return
    }
    await this.connection.query("SELECT pg_advisory_unlock(707518210001)")
    this.#leased = false
  }
  async acquireDdlLock(requirement: "shared" | "exclusive", signal?: AbortSignal): Promise<void> {
    if (requirement !== "exclusive" || this.#ddlLock) {
      throw new Error(`PostgreSQL migration sessions do not support DDL lock ${requirement}`)
    }
    while (!this.#ddlLock) {
      signal?.throwIfAborted()
      const result = await this.connection.query(
        "SELECT pg_try_advisory_lock(707518210002) AS acquired",
      )

      this.#ddlLock = result.rows[0]?.acquired === true
      if (!this.#ddlLock) {
        await delay(this.poll, signal)
      }
    }
  }
  async releaseDdlLock(requirement: "shared" | "exclusive"): Promise<void> {
    if (requirement !== "exclusive" || !this.#ddlLock) {
      throw new Error(`PostgreSQL migration session does not hold DDL lock ${requirement}`)
    }
    await this.connection.query("SELECT pg_advisory_unlock(707518210002)")
    this.#ddlLock = false
  }
  async beginTransaction(): Promise<void> {
    if (this.#transaction) {
      throw new Error("A migration transaction is already active")
    }
    await this.connection.query("BEGIN")
    this.#transaction = true
  }
  async commitTransaction(): Promise<void> {
    this.#requiredTransaction()
    try {
      await this.connection.query("COMMIT")
    } finally {
      this.#transaction = false
    }
  }
  async rollbackTransaction(): Promise<void> {
    this.#requiredTransaction()
    try {
      await this.connection.query("ROLLBACK")
    } finally {
      this.#transaction = false
    }
  }
  async execute(sql: string, parameters: readonly TaggedParameterValue[]): Promise<void> {
    await this.connection.query(sql, parameters.map(decodeParameter))
  }
  async checkCondition(condition: ProgramCondition): Promise<boolean> {
    if (condition.type === "snapshot-digest") {
      return (
        isSha256Digest(condition.value) && (await this.currentSnapshotDigest()) === condition.value
      )
    }
    if (condition.type === "statement") {
      if (typeof condition.value !== "string") {
        return false
      }
      const result = await this.connection.query(condition.value)

      return truthy(Object.values(result.rows[0] ?? {})[0])
    }

    const value = asObject(condition.value)
    const name = typeof value?.physicalName === "string" ? value.physicalName : undefined
    const kind = typeof value?.kind === "string" ? value.kind : undefined

    if (!name || !kind) {
      return false
    }
    const present = await objectPresent(this.connection, kind, name, value!)

    return condition.type === "object-present" ? present : !present
  }
  async readSnapshot(expected?: MigrationSnapshot): Promise<MigrationSnapshotInspection> {
    const value = await this.options.readSnapshot(this.connection, expected)

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
  async currentSnapshotDigest(expected?: MigrationSnapshot): Promise<Sha256Digest> {
    const value = await this.options.readSnapshot(this.connection, expected)

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
    if (this.#ddlLock) {
      try {
        await this.releaseDdlLock("exclusive")
      } catch (error) {
        failure ??= error
      }
    }
    if (this.#leased) {
      try {
        await this.releaseLease()
      } catch (error) {
        failure ??= error
      }
    }
    try {
      await this.connection.close?.()
    } catch (error) {
      failure ??= error
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

      return code?.startsWith("08") ? "uncertain" : code ? "definite-failure" : "uncertain"
    }

    return "before-execution"
  }
  #requiredTransaction(): void {
    if (!this.#transaction) {
      throw new Error("No migration transaction is active")
    }
  }
}

class PostgresMigrationJournal implements MigrationJournal {
  constructor(
    readonly connection: PostgresMigrationConnection,
    readonly inTransaction: () => boolean,
  ) {}
  async readMetadata(): Promise<JournalMetadata> {
    const row = (
      await this.connection.query(
        "SELECT format, version, head FROM __qubu_migration_metadata WHERE singleton = 1",
      )
    ).rows[0]

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
    return (
      await this.connection.query(
        "SELECT artifact_id, sequence, artifact_digest, parent_artifact_digest, kind, attempt_id, applied_at FROM __qubu_migration_applied ORDER BY sequence",
      )
    ).rows.map((row) => ({
      artifactId: text(row.artifact_id),
      sequence: Number(row.sequence),
      artifactDigest: digest(row.artifact_digest),
      parentArtifactDigest: nullableDigest(row.parent_artifact_digest),
      kind: text(row.kind) as "migration" | "baseline",
      attemptId: text(row.attempt_id),
      appliedAt: dateText(row.applied_at),
    }))
  }
  async listAttempts(): Promise<readonly MigrationAttempt[]> {
    return (
      await this.connection.query(
        "SELECT id, artifact_id, artifact_digest, expected_head, state, started_at, updated_at, error FROM __qubu_migration_attempts ORDER BY started_at, id",
      )
    ).rows.map((row) => ({
      id: text(row.id),
      artifactId: text(row.artifact_id),
      artifactDigest: digest(row.artifact_digest),
      expectedHead: nullableDigest(row.expected_head),
      state: text(row.state) as AttemptState,
      startedAt: dateText(row.started_at),
      updatedAt: dateText(row.updated_at),
      ...(row.error == null
        ? {}
        : {
            error: (typeof row.error === "string"
              ? JSON.parse(row.error)
              : row.error) as JournalFailure,
          }),
    }))
  }
  async listCheckpoints(attemptId: string): Promise<readonly PhaseCheckpoint[]> {
    return (
      await this.connection.query(
        "SELECT attempt_id, phase_id, statement_id, status, recorded_at FROM __qubu_migration_checkpoints WHERE attempt_id = $1 ORDER BY sequence",
        [attemptId],
      )
    ).rows.map((row) => ({
      attemptId: text(row.attempt_id),
      phaseId: text(row.phase_id),
      ...(row.statement_id == null ? {} : { statementId: text(row.statement_id) }),
      status: text(row.status) as "started" | "completed",
      recordedAt: dateText(row.recorded_at),
    }))
  }
  async listReconciliations(): Promise<readonly ReconciliationRecord[]> {
    return (
      await this.connection.query(
        "SELECT attempt_id, outcome, reason, reconciled_at FROM __qubu_migration_reconciliations ORDER BY reconciled_at, attempt_id",
      )
    ).rows.map((row) => ({
      attemptId: text(row.attempt_id),
      outcome: text(row.outcome) as "applied" | "rolled_back",
      reason: text(row.reason),
      reconciledAt: dateText(row.reconciled_at),
    }))
  }
  async createAttempt(value: MigrationAttempt): Promise<void> {
    if (value.state !== "started") {
      throw new Error("A new attempt must be started")
    }
    await this.connection.query(
      "INSERT INTO __qubu_migration_attempts (id, artifact_id, artifact_digest, expected_head, state, started_at, updated_at, error) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)",
      [
        value.id,
        value.artifactId,
        value.artifactDigest,
        value.expectedHead,
        value.state,
        value.startedAt,
        value.updatedAt,
      ],
    )
  }
  async transitionAttempt(id: string, state: AttemptState, error?: JournalFailure): Promise<void> {
    const current = (
      await this.connection.query("SELECT state FROM __qubu_migration_attempts WHERE id = $1", [id])
    ).rows[0]

    if (!current || !canTransitionAttempt(text(current.state) as AttemptState, state)) {
      throw new Error("Invalid migration attempt transition")
    }
    const result = await this.connection.query(
      "UPDATE __qubu_migration_attempts SET state=$1, updated_at=$2, error=$3 WHERE id=$4 AND state=$5",
      [
        state,
        new Date().toISOString(),
        error ? canonicalText(error as unknown as SnapshotJsonValue).trimEnd() : null,
        id,
        current.state,
      ],
    )

    if (result.affectedRows !== 1) {
      throw new Error("Migration attempt changed concurrently")
    }
  }
  async checkpoint(value: PhaseCheckpoint): Promise<void> {
    await this.connection.query(
      "INSERT INTO __qubu_migration_checkpoints (attempt_id, phase_id, statement_id, status, recorded_at) VALUES ($1,$2,$3,$4,$5)",
      [value.attemptId, value.phaseId, value.statementId ?? null, value.status, value.recordedAt],
    )
  }
  async appendApplied(value: AppliedArtifactRecord): Promise<void> {
    if ((await this.readMetadata()).head !== value.parentArtifactDigest) {
      throw new Error("Applied record does not extend journal head")
    }
    await this.insertApplied(value)
  }
  async compareAndSwapHead(expected: Sha256Digest | null, next: Sha256Digest): Promise<boolean> {
    return (
      (
        await this.connection.query(
          "UPDATE __qubu_migration_metadata SET head=$1 WHERE singleton=1 AND head IS NOT DISTINCT FROM $2",
          [next, expected],
        )
      ).affectedRows === 1
    )
  }
  async appendAppliedAndAdvanceHead(
    value: AppliedArtifactRecord,
    expected: Sha256Digest | null,
  ): Promise<boolean> {
    const owned = !this.inTransaction()

    if (owned) {
      await this.connection.query("BEGIN")
    }
    try {
      if (
        (await this.readMetadata()).head !== expected ||
        value.parentArtifactDigest !== expected
      ) {
        if (owned) {
          await this.connection.query("ROLLBACK")
        }
        return false
      }

      await this.insertApplied(value)
      if (!(await this.compareAndSwapHead(expected, value.artifactDigest))) {
        throw new Error("Journal head changed after applied history was appended")
      }
      if (owned) {
        await this.connection.query("COMMIT")
      }
      return true
    } catch (error) {
      if (owned) {
        await this.connection.query("ROLLBACK").catch(() => {})
      }
      throw error
    }
  }
  async recordReconciliation(value: ReconciliationRecord): Promise<void> {
    await this.connection.query(
      "INSERT INTO __qubu_migration_reconciliations (attempt_id, outcome, reason, reconciled_at) VALUES ($1,$2,$3,$4)",
      [value.attemptId, value.outcome, value.reason, value.reconciledAt],
    )
  }
  private async insertApplied(value: AppliedArtifactRecord): Promise<void> {
    await this.connection.query(
      "INSERT INTO __qubu_migration_applied (artifact_id, sequence, artifact_digest, parent_artifact_digest, kind, attempt_id, applied_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        value.artifactId,
        value.sequence,
        value.artifactDigest,
        value.parentArtifactDigest,
        value.kind,
        value.attemptId,
        value.appliedAt,
      ],
    )
  }
}

async function initializeJournal(connection: PostgresMigrationConnection): Promise<void> {
  for (const sql of [
    "CREATE TABLE IF NOT EXISTS __qubu_migration_metadata (singleton integer PRIMARY KEY CHECK (singleton = 1), format text NOT NULL, version integer NOT NULL, head text)",
    "CREATE TABLE IF NOT EXISTS __qubu_migration_applied (artifact_id text PRIMARY KEY, sequence integer NOT NULL UNIQUE, artifact_digest text NOT NULL UNIQUE, parent_artifact_digest text, kind text NOT NULL CHECK (kind IN ('migration','baseline')), attempt_id text NOT NULL UNIQUE, applied_at text NOT NULL)",
    "CREATE TABLE IF NOT EXISTS __qubu_migration_attempts (id text PRIMARY KEY, artifact_id text NOT NULL, artifact_digest text NOT NULL, expected_head text, state text NOT NULL CHECK (state IN ('started','running','applied','rolled_back','recovery_required')), started_at text NOT NULL, updated_at text NOT NULL, error jsonb)",
    "CREATE TABLE IF NOT EXISTS __qubu_migration_checkpoints (sequence bigint GENERATED ALWAYS AS IDENTITY, attempt_id text NOT NULL, phase_id text NOT NULL, statement_id text, status text NOT NULL CHECK (status IN ('started','completed')), recorded_at text NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS __qubu_migration_checkpoints_unique ON __qubu_migration_checkpoints (attempt_id, phase_id, coalesce(statement_id, ''), status)",
    "CREATE TABLE IF NOT EXISTS __qubu_migration_reconciliations (attempt_id text PRIMARY KEY, outcome text NOT NULL CHECK (outcome IN ('applied','rolled_back')), reason text NOT NULL, reconciled_at text NOT NULL)",
  ]) {
    await connection.query(sql)
  }
  await connection.query(
    "INSERT INTO __qubu_migration_metadata (singleton, format, version, head) VALUES (1,$1,$2,NULL) ON CONFLICT DO NOTHING",
    [migrationJournalFormat, migrationJournalVersion],
  )
}

function decodeParameter(value: TaggedParameterValue): unknown {
  switch (value.type) {
    case "null": {
      return null
    }
    case "boolean": {
      return value.value
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
      return value.value
    }
    case "bytes": {
      return Uint8Array.from(atob(value.base64), (character) => character.charCodeAt(0))
    }
    case "json": {
      return canonicalText(value.value).trimEnd()
    }
  }
}

async function objectPresent(
  connection: PostgresMigrationConnection,
  kind: string,
  name: string,
  value: Record<string, unknown>,
): Promise<boolean> {
  const path = Array.isArray(value.path) ? value.path : []
  const table = typeof path[0] === "string" ? path[0] : undefined

  if (kind === "column" && table) {
    return (
      (
        await connection.query(
          "SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2",
          [table, name],
        )
      ).rows.length > 0
    )
  }
  const relation = kind === "table" || kind === "view" || kind === "index"

  return (
    relation &&
    (await connection.query("SELECT to_regclass($1) AS value", [name])).rows[0]?.value != null
  )
}

function text(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Invalid migration journal text")
  }
  return value
}

function dateText(value: unknown): string {
  return value instanceof Date ? value.toISOString() : text(value)
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

function asObject(value: SnapshotJsonValue): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
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
  return value === true || value === 1 || value === 1n || value === "1" || value === "t"
}

function failureCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}
