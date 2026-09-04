import type { Client, InStatement, InValue, ResultSet, Transaction } from "@libsql/client"
import { canonicalText, digestCanonical, isSha256Digest } from "@qubu/migrate/artifact"
import type { ProgramCondition, Sha256Digest, TaggedParameterValue } from "@qubu/migrate/artifact"
import { compareManagedSnapshots } from "@qubu/migrate/baseline"
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
import { mapCatalogToSnapshot } from "qubu/introspection"
import { readCatalog } from "qubu/introspection/sqlite"
import { assertSchemaSnapshot } from "qubu/snapshot"
import type { SchemaSnapshot, SchemaSnapshotInput, SnapshotJsonValue } from "qubu/snapshot"

const metadataTable = "__qubu_migration_metadata"
const appliedTable = "__qubu_migration_applied"
const attemptsTable = "__qubu_migration_attempts"
const checkpointsTable = "__qubu_migration_checkpoints"
const reconciliationsTable = "__qubu_migration_reconciliations"
const leaseTable = "__qubu_migration_lease"
const checkpointUniqueIndex = "__qubu_migration_checkpoints_unique"
const defaultLeasePollMilliseconds = 10
const defaultLeaseDurationMilliseconds = 30_000
const minimumLeaseDurationMilliseconds = 1_000
const databaseNowMilliseconds = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"

interface Executor {
  execute(statement: InStatement | string): Promise<ResultSet>
}

export interface LibsqlMigrationSnapshotReader {
  (
    executor: {
      execute(statement: InStatement | string): Promise<ResultSet>
    },
    expected?: SchemaSnapshot,
  ): Promise<SnapshotJsonValue | SchemaSnapshot | Sha256Digest | MigrationSnapshotInspection>
}

export interface LibsqlMigrationAdapterOptions {
  /** Read the managed live snapshot. Qubu journal objects must be excluded by the reader. */
  readonly readSnapshot?: LibsqlMigrationSnapshotReader
  readonly leasePollMilliseconds?: number
  /** Duration of a database lease before an owner must renew it. */
  readonly leaseDurationMilliseconds?: number
}

export interface LibsqlMigrationAdapter extends MigrationAdapter {
  readonly client: Client
}

/** Adapt one application-owned libSQL client to Qubu's pinned migration-session contract. */
export function libsqlMigrationAdapter(
  client: Client,
  options: LibsqlMigrationAdapterOptions = {},
): LibsqlMigrationAdapter {
  if (
    !Number.isFinite(options.leasePollMilliseconds ?? defaultLeasePollMilliseconds) ||
    (options.leasePollMilliseconds ?? defaultLeasePollMilliseconds) < 0
  )
    throw new TypeError("leasePollMilliseconds must be a non-negative finite number")
  if (
    !Number.isFinite(options.leaseDurationMilliseconds ?? defaultLeaseDurationMilliseconds) ||
    (options.leaseDurationMilliseconds ?? defaultLeaseDurationMilliseconds) <
      minimumLeaseDurationMilliseconds
  )
    throw new TypeError(
      `leaseDurationMilliseconds must be a finite number of at least ${minimumLeaseDurationMilliseconds}`,
    )

  return {
    client,
    async openMigrationSession(signal?: AbortSignal): Promise<MigrationSession> {
      signal?.throwIfAborted()
      await initializeJournal(client)
      return new LibsqlMigrationSession(client, options)
    },
  }
}

/**
 * Read SQLite's physical catalog in strict mode. Every Qubu migration object is removed before
 * mapping, including future journal objects that use the reserved prefix.
 */
export async function readLibsqlMigrationSnapshot(
  executor: Executor,
  expected?: SchemaSnapshot,
): Promise<MigrationSnapshotInspection> {
  const catalog = await readCatalog(
    {
      dialect: "sqlite",
      async query<TRow extends Readonly<Record<string, unknown>>>(statement: {
        readonly text: string
        readonly parameters: readonly unknown[]
      }): Promise<readonly TRow[]> {
        const result = await executor.execute({
          sql: statement.text,
          args: statement.parameters as InValue[],
        })
        return result.rows as unknown as readonly TRow[]
      },
    },
    {
      namespace: expected?.namespace.name ?? "main",
      mode: "strict",
      ...(expected === undefined ? {} : { previousSnapshot: expected }),
    },
  )
  const owned = (name: string | undefined): boolean =>
    name?.startsWith("__qubu_migration_") === true
  const ownedTableIds = new Set(
    catalog.tables.filter((table) => owned(table.physicalName)).map((table) => table.id),
  )
  const withoutJournal = {
    ...catalog,
    tables: catalog.tables.filter((table) => !owned(table.physicalName)),
    views: (catalog.views ?? []).filter((view) => !owned(view.physicalName)),
    triggers: (catalog.triggers ?? []).filter(
      (trigger) => !owned(trigger.physicalName) && !ownedTableIds.has(trigger.table.id),
    ),
    deferredObjects: catalog.deferredObjects.filter((item) => !owned(item.physicalName)),
    opaqueObjects: (catalog.opaqueObjects ?? []).filter((item) => !owned(item.physicalName)),
  }
  const expectedNames = new Set(expected?.tables.map((table) => table.physicalName) ?? [])
  const unmanagedObjects =
    expected === undefined
      ? []
      : withoutJournal.tables
          .filter((table) => !expectedNames.has(table.physicalName))
          .map((table) => ({ kind: "table", physicalName: table.physicalName }))
  const managedCatalog =
    expected === undefined
      ? withoutJournal
      : {
          ...withoutJournal,
          tables: withoutJournal.tables.filter((table) => expectedNames.has(table.physicalName)),
        }
  const mapped = mapCatalogToSnapshot(managedCatalog, {
    namespace: expected?.namespace.name ?? "main",
    mode: "strict",
    ...(expected === undefined ? {} : { previousSnapshot: expected }),
  })
  if (!mapped.ok) {
    throw new Error(
      `Strict SQLite introspection failed: ${mapped.diagnostics.map((item) => item.message).join("; ")}`,
    )
  }
  return Object.freeze({
    snapshot: mapped.snapshot,
    unmanagedObjects: Object.freeze(unmanagedObjects),
  })
}

class LibsqlMigrationSession implements MigrationSession {
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
  })
  readonly journal: MigrationJournal
  readonly #leaseToken = crypto.randomUUID()
  readonly #client: Client
  readonly #options: LibsqlMigrationAdapterOptions
  readonly #leaseDurationMilliseconds: number
  readonly #leaseHeartbeatMilliseconds: number
  #transaction: Transaction | undefined
  #leased = false
  #leaseStarted = false
  #leaseTimer: ReturnType<typeof setInterval> | undefined
  #leaseRenewal: Promise<void> | undefined
  #leaseError: Error | undefined
  #closed = false
  #ddlLock = false
  #expectedSnapshot: SchemaSnapshot | undefined

  constructor(client: Client, options: LibsqlMigrationAdapterOptions) {
    this.#client = client
    this.#options = options
    const leaseDurationMilliseconds =
      options.leaseDurationMilliseconds ?? defaultLeaseDurationMilliseconds
    this.#leaseDurationMilliseconds = Math.ceil(leaseDurationMilliseconds)
    this.#leaseHeartbeatMilliseconds = Math.max(250, Math.floor(leaseDurationMilliseconds / 3))
    this.journal = new LibsqlMigrationJournal(
      client,
      () => this.#executor(),
      () => this.#transaction,
      () => this.#assertLease(),
    )
  }

  async acquireLease(signal?: AbortSignal): Promise<void> {
    this.#open()
    this.#leaseStarted = true
    while (!this.#leased) {
      signal?.throwIfAborted()
      try {
        const result = await this.#client.execute({
          sql: `INSERT INTO ${leaseTable} (singleton, owner, expires_at)
            VALUES (1, ?, ${databaseNowMilliseconds} + ?)
            ON CONFLICT(singleton) DO UPDATE SET
              owner = excluded.owner,
              expires_at = excluded.expires_at
            WHERE ${leaseTable}.expires_at <= ${databaseNowMilliseconds}`,
          args: [this.#leaseToken, this.#leaseDurationMilliseconds],
        })
        if (result.rowsAffected === 1) {
          this.#leased = true
          this.#leaseError = undefined
          this.#startLeaseHeartbeat()
          return
        }
      } catch (error) {
        let state: LeaseState | undefined
        try {
          state = await leaseState(this.#client)
        } catch {
          throw error
        }
        if (state?.owner === this.#leaseToken && state.expiresAt > state.now) {
          this.#leased = true
          this.#leaseError = undefined
          this.#startLeaseHeartbeat()
          return
        }
      }
      await delay(this.#options.leasePollMilliseconds ?? defaultLeasePollMilliseconds, signal)
    }
  }

  async releaseLease(): Promise<void> {
    if (!this.#leased) return
    this.#stopLeaseHeartbeat()
    await this.#leaseRenewal?.catch(() => undefined)
    await this.#client.execute({
      sql: `DELETE FROM ${leaseTable} WHERE singleton = 1 AND owner = ?`,
      args: [this.#leaseToken],
    })
    this.#leased = false
    this.#leaseError = undefined
  }

  async acquireDdlLock(requirement: "shared" | "exclusive"): Promise<void> {
    this.#open()
    if (requirement !== "exclusive" || this.#ddlLock)
      throw new Error(`libSQL migration sessions do not support DDL lock ${requirement}`)
    this.#ddlLock = true
  }
  async releaseDdlLock(requirement: "shared" | "exclusive"): Promise<void> {
    if (requirement !== "exclusive" || !this.#ddlLock)
      throw new Error(`libSQL migration session does not hold DDL lock ${requirement}`)
    this.#ddlLock = false
  }

  async beginTransaction(): Promise<void> {
    this.#open()
    if (this.#transaction) throw new Error("A migration transaction is already active")
    await this.#assertLease()
    this.#transaction = await this.#client.transaction("write")
  }

  async commitTransaction(): Promise<void> {
    const transaction = this.#requiredTransaction()
    await this.#assertLease()
    try {
      await transaction.commit()
    } finally {
      transaction.close()
      this.#transaction = undefined
    }
  }

  async rollbackTransaction(): Promise<void> {
    const transaction = this.#requiredTransaction()
    try {
      if (!transaction.closed) await transaction.rollback()
    } finally {
      transaction.close()
      this.#transaction = undefined
    }
  }

  async execute(sql: string, parameters: readonly TaggedParameterValue[]): Promise<void> {
    this.#open()
    await this.#executor().execute({ sql, args: parameters.map(decodeParameter) })
  }

  async checkCondition(condition: ProgramCondition): Promise<boolean> {
    this.#open()
    if (condition.type === "snapshot-fingerprint") {
      const { snapshot } = await this.readSnapshot(this.#expectedSnapshot)
      return evaluateMigrationPrecondition(snapshot, condition.value)
    }
    if (condition.type === "snapshot-digest") {
      if (!isSha256Digest(condition.value)) return false
      return (await this.currentSnapshotDigest()) === condition.value
    }
    if (condition.type === "statement") {
      if (typeof condition.value !== "string") return false
      const result = await this.#executor().execute(condition.value)
      return truthy(result.rows[0]?.[0])
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
    this.#open()
    const snapshot = normalizeSnapshot(
      await (this.#options.readSnapshot ?? readLibsqlMigrationSnapshot)(this.#executor(), expected),
    )
    if (isSha256Digest(snapshot)) {
      throw new TypeError("The configured snapshot reader returned only a digest")
    }
    return snapshot
  }

  async currentSnapshotDigest(expected?: SchemaSnapshot): Promise<Sha256Digest> {
    this.#open()
    if (expected !== undefined) this.#expectedSnapshot = expected
    const snapshot = normalizeSnapshot(
      await (this.#options.readSnapshot ?? readLibsqlMigrationSnapshot)(this.#executor(), expected),
    )
    if (isSha256Digest(snapshot)) return snapshot
    const value = snapshot.snapshot
    if (expected && compareManagedSnapshots(expected, value).matches)
      return digestCanonical("schema-snapshot", expected as unknown as SnapshotJsonValue)
    return digestCanonical("schema-snapshot", value as unknown as SnapshotJsonValue)
  }

  async close(): Promise<void> {
    if (this.#closed) return
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
    if (failure) throw failure
  }

  classifyFailure(error: unknown, boundary: MigrationAwaitBoundary): AdapterFailureClassification {
    if (boundary === "commit-transaction" || boundary === "rollback-transaction") return "uncertain"
    if (boundary === "execute-statement") {
      const code = failureCode(error)
      if (code === "CLIENT_CLOSED" || code === "TRANSACTION_CLOSED") return "before-execution"
      return code?.startsWith("SQLITE_") ? "definite-failure" : "uncertain"
    }
    return "before-execution"
  }

  #executor(): Executor {
    this.#open()
    const executor = this.#transaction ?? this.#client
    return {
      execute: async (statement) => {
        await this.#assertLease()
        return executor.execute(statement)
      },
    }
  }
  #requiredTransaction(): Transaction {
    this.#open()
    if (!this.#transaction) throw new Error("No migration transaction is active")
    return this.#transaction
  }
  #open(): void {
    if (this.#closed) throw new Error("Migration session is closed")
  }
  #startLeaseHeartbeat(): void {
    if (this.#leaseTimer) return
    this.#leaseTimer = setInterval(() => {
      if (this.#leaseRenewal || !this.#leased || this.#closed) return
      const renewal = this.#renewLease()
      this.#leaseRenewal = renewal
      void renewal.then(
        () => {
          if (this.#leaseRenewal === renewal) this.#leaseRenewal = undefined
        },
        (error: unknown) => {
          this.#markLeaseLost(error)
          if (this.#leaseRenewal === renewal) this.#leaseRenewal = undefined
        },
      )
    }, this.#leaseHeartbeatMilliseconds)
  }
  #stopLeaseHeartbeat(): void {
    if (this.#leaseTimer) clearInterval(this.#leaseTimer)
    this.#leaseTimer = undefined
  }
  async #renewLease(): Promise<void> {
    const result = await this.#client.execute({
      sql: `UPDATE ${leaseTable}
        SET expires_at = ${databaseNowMilliseconds} + ?
        WHERE singleton = 1 AND owner = ? AND expires_at > ${databaseNowMilliseconds}`,
      args: [this.#leaseDurationMilliseconds, this.#leaseToken],
    })
    if (result.rowsAffected !== 1) throw new Error("The libSQL migration lease was lost")
  }
  async #assertLease(): Promise<void> {
    this.#open()
    if (!this.#leaseStarted) return
    if (!this.#leased) throw this.#leaseError ?? new Error("The migration session has no lease")
    if (this.#leaseError) throw this.#leaseError

    let state: LeaseState | undefined
    try {
      state = await leaseState(this.#client)
    } catch (error) {
      this.#markLeaseLost(error)
      throw error
    }
    if (!state || state.owner !== this.#leaseToken || state.expiresAt <= state.now) {
      const error = new Error("The libSQL migration lease is no longer held")
      this.#markLeaseLost(error)
      throw error
    }
    if (state.expiresAt - state.now <= this.#leaseHeartbeatMilliseconds) {
      try {
        await this.#renewLease()
      } catch (error) {
        this.#markLeaseLost(error)
        throw error
      }
    }
  }
  #markLeaseLost(error: unknown): void {
    this.#leaseError ??=
      error instanceof Error
        ? error
        : new Error("The libSQL migration lease was lost", { cause: error })
    this.#stopLeaseHeartbeat()
  }
}

class LibsqlMigrationJournal implements MigrationJournal {
  constructor(
    readonly client: Client,
    readonly executor: () => Executor,
    readonly transaction: () => Transaction | undefined,
    readonly assertLease: () => Promise<void>,
  ) {}

  async readMetadata(): Promise<JournalMetadata> {
    const row = first(
      await this.executor().execute(
        `SELECT format, version, head FROM ${metadataTable} WHERE singleton = 1`,
      ),
    )
    if (!row) throw new Error("Migration journal metadata is missing")
    return {
      format: string(row.format) as typeof migrationJournalFormat,
      version: number(row.version) as 1,
      head: nullableDigest(row.head),
    }
  }
  async listApplied(): Promise<readonly AppliedArtifactRecord[]> {
    const result = await this.executor().execute(
      `SELECT artifact_id, sequence, artifact_digest, parent_artifact_digest, kind, attempt_id, applied_at FROM ${appliedTable} ORDER BY sequence`,
    )
    return result.rows.map((row) => ({
      artifactId: string(row.artifact_id),
      sequence: number(row.sequence),
      artifactDigest: digest(row.artifact_digest),
      parentArtifactDigest: nullableDigest(row.parent_artifact_digest),
      kind: string(row.kind) as "migration" | "baseline",
      attemptId: string(row.attempt_id),
      appliedAt: string(row.applied_at),
    }))
  }
  async listAttempts(): Promise<readonly MigrationAttempt[]> {
    const result = await this.executor().execute(
      `SELECT id, artifact_id, artifact_digest, expected_head, state, started_at, updated_at, error FROM ${attemptsTable} ORDER BY started_at, id`,
    )
    return result.rows.map((row) => ({
      id: string(row.id),
      artifactId: string(row.artifact_id),
      artifactDigest: digest(row.artifact_digest),
      expectedHead: nullableDigest(row.expected_head),
      state: string(row.state) as AttemptState,
      startedAt: string(row.started_at),
      updatedAt: string(row.updated_at),
      ...(row.error == null ? {} : { error: JSON.parse(string(row.error)) as JournalFailure }),
    }))
  }
  async listCheckpoints(attemptId: string): Promise<readonly PhaseCheckpoint[]> {
    const result = await this.executor().execute({
      sql: `SELECT attempt_id, phase_id, statement_id, status, recorded_at FROM ${checkpointsTable} WHERE attempt_id = ? ORDER BY rowid`,
      args: [attemptId],
    })
    return result.rows.map((row) => ({
      attemptId: string(row.attempt_id),
      phaseId: string(row.phase_id),
      ...(row.statement_id == null ? {} : { statementId: string(row.statement_id) }),
      status: string(row.status) as "started" | "completed",
      recordedAt: string(row.recorded_at),
    }))
  }
  async listReconciliations(): Promise<readonly ReconciliationRecord[]> {
    const result = await this.executor().execute(
      `SELECT attempt_id, outcome, reason, reconciled_at FROM ${reconciliationsTable} ORDER BY rowid`,
    )
    return result.rows.map((row) => ({
      attemptId: string(row.attempt_id),
      outcome: string(row.outcome) as "applied" | "rolled_back",
      reason: string(row.reason),
      reconciledAt: string(row.reconciled_at),
    }))
  }
  async createAttempt(value: MigrationAttempt): Promise<void> {
    if (value.state !== "started") throw new Error("A new attempt must be started")
    await this.executor().execute({
      sql: `INSERT INTO ${attemptsTable} (id, artifact_id, artifact_digest, expected_head, state, started_at, updated_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      args: [
        value.id,
        value.artifactId,
        value.artifactDigest,
        value.expectedHead,
        value.state,
        value.startedAt,
        value.updatedAt,
      ],
    })
  }
  async transitionAttempt(id: string, state: AttemptState, error?: JournalFailure): Promise<void> {
    const currentResult = await this.executor().execute({
      sql: `SELECT state FROM ${attemptsTable} WHERE id = ?`,
      args: [id],
    })
    const current = first(currentResult)
    if (!current || !canTransitionAttempt(string(current.state) as AttemptState, state))
      throw new Error("Invalid migration attempt transition")
    const result = await this.executor().execute({
      sql: `UPDATE ${attemptsTable} SET state = ?, updated_at = ?, error = ? WHERE id = ? AND state = ?`,
      args: [
        state,
        new Date().toISOString(),
        error ? canonicalText(error as unknown as SnapshotJsonValue).trimEnd() : null,
        id,
        current.state as InValue,
      ],
    })
    if (result.rowsAffected !== 1) throw new Error("Migration attempt changed concurrently")
  }
  async checkpoint(value: PhaseCheckpoint): Promise<void> {
    await this.executor().execute({
      sql: `INSERT INTO ${checkpointsTable} (attempt_id, phase_id, statement_id, status, recorded_at) VALUES (?, ?, ?, ?, ?)`,
      args: [
        value.attemptId,
        value.phaseId,
        value.statementId ?? null,
        value.status,
        value.recordedAt,
      ],
    })
  }
  async appendApplied(value: AppliedArtifactRecord): Promise<void> {
    const metadata = await this.readMetadata()
    if (metadata.head !== value.parentArtifactDigest)
      throw new Error("Applied record does not extend journal head")
    await this.insertApplied(value)
  }
  async compareAndSwapHead(expected: Sha256Digest | null, next: Sha256Digest): Promise<boolean> {
    const result = await this.executor().execute({
      sql: `UPDATE ${metadataTable} SET head = ? WHERE singleton = 1 AND ((head IS NULL AND ? IS NULL) OR head = ?)`,
      args: [next, expected, expected],
    })
    return result.rowsAffected === 1
  }
  async appendAppliedAndAdvanceHead(
    value: AppliedArtifactRecord,
    expected: Sha256Digest | null,
  ): Promise<boolean> {
    const active = this.transaction()
    if (active) {
      return this.appendAndAdvance(guardedExecutor(active, this.assertLease), value, expected)
    }

    await this.assertLease()
    const transaction = await this.client.transaction("write")
    try {
      const advanced = await this.appendAndAdvance(
        guardedExecutor(transaction, this.assertLease),
        value,
        expected,
      )
      await this.assertLease()
      await transaction.commit()
      return advanced
    } catch (error) {
      if (!transaction.closed) {
        await transaction.rollback()
      }
      throw error
    } finally {
      transaction.close()
    }
  }
  async recordReconciliation(value: ReconciliationRecord): Promise<void> {
    await this.executor().execute({
      sql: `INSERT INTO ${reconciliationsTable} (attempt_id, outcome, reason, reconciled_at) VALUES (?, ?, ?, ?)`,
      args: [value.attemptId, value.outcome, value.reason, value.reconciledAt],
    })
  }
  private async insertApplied(value: AppliedArtifactRecord): Promise<void> {
    await this.executor().execute({
      sql: `INSERT INTO ${appliedTable} (artifact_id, sequence, artifact_digest, parent_artifact_digest, kind, attempt_id, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        value.artifactId,
        value.sequence,
        value.artifactDigest,
        value.parentArtifactDigest,
        value.kind,
        value.attemptId,
        value.appliedAt,
      ],
    })
  }

  private async appendAndAdvance(
    executor: Executor,
    value: AppliedArtifactRecord,
    expected: Sha256Digest | null,
  ): Promise<boolean> {
    const metadataRow = first(
      await executor.execute(`SELECT head FROM ${metadataTable} WHERE singleton = 1`),
    )
    if (nullableDigest(metadataRow?.head) !== expected || value.parentArtifactDigest !== expected) {
      return false
    }
    await executor.execute({
      sql: `INSERT INTO ${appliedTable} (artifact_id, sequence, artifact_digest, parent_artifact_digest, kind, attempt_id, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        value.artifactId,
        value.sequence,
        value.artifactDigest,
        value.parentArtifactDigest,
        value.kind,
        value.attemptId,
        value.appliedAt,
      ],
    })
    const result = await executor.execute({
      sql: `UPDATE ${metadataTable} SET head = ? WHERE singleton = 1 AND ((head IS NULL AND ? IS NULL) OR head = ?)`,
      args: [value.artifactDigest, expected, expected],
    })
    if (result.rowsAffected !== 1) {
      throw new Error("Journal head changed after applied history was appended")
    }
    return true
  }
}

function guardedExecutor(executor: Executor, assertLease: () => Promise<void>): Executor {
  return {
    execute: async (statement) => {
      await assertLease()
      return executor.execute(statement)
    },
  }
}

async function initializeJournal(client: Client): Promise<void> {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS ${metadataTable} (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), format TEXT NOT NULL, version INTEGER NOT NULL, head TEXT)`,
      `CREATE TABLE IF NOT EXISTS ${appliedTable} (artifact_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE, artifact_digest TEXT NOT NULL UNIQUE, parent_artifact_digest TEXT, kind TEXT NOT NULL CHECK (kind IN ('migration', 'baseline')), attempt_id TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS ${attemptsTable} (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, artifact_digest TEXT NOT NULL, expected_head TEXT, state TEXT NOT NULL CHECK (state IN ('started', 'running', 'applied', 'rolled_back', 'recovery_required')), started_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT)`,
      `CREATE TABLE IF NOT EXISTS ${checkpointsTable} (attempt_id TEXT NOT NULL, phase_id TEXT NOT NULL, statement_id TEXT, status TEXT NOT NULL CHECK (status IN ('started', 'completed')), recorded_at TEXT NOT NULL)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS ${checkpointUniqueIndex} ON ${checkpointsTable} (attempt_id, phase_id, COALESCE(statement_id, ''), status)`,
      `CREATE TABLE IF NOT EXISTS ${reconciliationsTable} (attempt_id TEXT PRIMARY KEY, outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'rolled_back')), reason TEXT NOT NULL, reconciled_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS ${leaseTable} (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), owner TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
      {
        sql: `INSERT OR IGNORE INTO ${metadataTable} (singleton, format, version, head) VALUES (1, ?, ?, NULL)`,
        args: [migrationJournalFormat, migrationJournalVersion],
      },
    ],
    "write",
  )
  await ensureLeaseExpirationColumn(client)
}

async function ensureLeaseExpirationColumn(client: Client): Promise<void> {
  const tableInfo = await client.execute(`PRAGMA table_info(${leaseTable})`)
  if (tableInfo.rows.some((row) => row.name === "expires_at")) return

  try {
    await client.execute(
      `ALTER TABLE ${leaseTable} ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0`,
    )
  } catch (error) {
    const refreshed = await client.execute(`PRAGMA table_info(${leaseTable})`)
    if (!refreshed.rows.some((row) => row.name === "expires_at")) throw error
  }
}

interface LeaseState {
  readonly owner: string
  readonly expiresAt: number
  readonly now: number
}

async function leaseState(client: Client): Promise<LeaseState | undefined> {
  const result = await client.execute(
    `SELECT owner, expires_at, ${databaseNowMilliseconds} AS now FROM ${leaseTable} WHERE singleton = 1`,
  )
  const row = first(result)
  if (!row) return undefined
  if (typeof row.owner !== "string") throw new Error("Invalid migration lease owner")
  return {
    owner: row.owner,
    expiresAt: number(row.expires_at),
    now: number(row.now),
  }
}

function decodeParameter(value: TaggedParameterValue): InValue {
  switch (value.type) {
    case "null":
      return null
    case "boolean":
      return value.value ? 1 : 0
    case "string":
      return value.value
    case "number": {
      const result = Number(value.value)
      if (!Number.isFinite(result)) throw new TypeError("Invalid tagged number")
      return result
    }
    case "bigint":
      return BigInt(value.value)
    case "bytes":
      return Uint8Array.from(atob(value.base64), (character) => character.charCodeAt(0))
    case "json":
      return canonicalText(value.value).trimEnd()
  }
}

function first(result: ResultSet): Record<string, InValue> | undefined {
  return result.rows[0] as Record<string, InValue> | undefined
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid migration journal text")
  return value
}
function number(value: unknown): number {
  if (
    typeof value !== "number" &&
    typeof value !== "bigint" &&
    (typeof value !== "string" || value.trim() === "")
  )
    throw new Error("Invalid migration journal number")
  const result = Number(value)
  if (!Number.isFinite(result)) throw new Error("Invalid migration journal number")
  return result
}
function digest(value: unknown): Sha256Digest {
  if (!isSha256Digest(value)) throw new Error("Invalid migration journal digest")
  return value
}
function nullableDigest(value: unknown): Sha256Digest | null {
  return value == null ? null : digest(value)
}
function isInspection(value: unknown): value is {
  readonly snapshot: unknown
  readonly unmanagedObjects: readonly unknown[]
} {
  return (
    value !== null &&
    typeof value === "object" &&
    "snapshot" in value &&
    "unmanagedObjects" in value &&
    Array.isArray(value.unmanagedObjects)
  )
}
function normalizeSnapshot(
  value: SnapshotJsonValue | SchemaSnapshot | Sha256Digest | MigrationSnapshotInspection,
): Sha256Digest | MigrationSnapshotInspection {
  if (isSha256Digest(value)) return value
  if (isInspection(value)) {
    const unmanagedObjects = value.unmanagedObjects.map((item, index) => {
      if (
        item === null ||
        typeof item !== "object" ||
        typeof item.kind !== "string" ||
        typeof item.physicalName !== "string"
      )
        throw new TypeError(`Invalid unmanaged snapshot object at index ${index}`)
      return Object.freeze({ kind: item.kind, physicalName: item.physicalName })
    })
    return Object.freeze({
      snapshot: assertSchemaSnapshot(value.snapshot as SchemaSnapshotInput),
      unmanagedObjects: Object.freeze(unmanagedObjects),
    })
  }
  return Object.freeze({
    snapshot: assertSchemaSnapshot(value as SchemaSnapshotInput),
    unmanagedObjects: Object.freeze([]),
  })
}
function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === 1n || value === "1"
}
function failureCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
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
