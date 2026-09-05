import type { Client, InStatement, InValue, ResultSet, Transaction } from "@libsql/client"
import { canonicalText, digestCanonical, isSha256Digest } from "@qubu/migrate/artifact"
import type {
  ExecutableMigrationArtifact,
  ProgramCondition,
  Sha256Digest,
  TaggedParameterValue,
} from "@qubu/migrate/artifact"
import { compareManagedSnapshots } from "@qubu/migrate/baseline"
import { MigrationExecutionError } from "@qubu/migrate/executor"
import type {
  AdapterFailureClassification,
  MigrationAdapter,
  MigrationAwaitBoundary,
  MigrationSession,
  MigrationSnapshotInspection,
  MigrationBatch,
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
import { evaluateMigrationPrecondition, isMigrationPrecondition } from "@qubu/migrate/plan"
import { mapCatalogToSnapshot } from "qubu/introspection"
import { readCatalog } from "qubu/introspection/sqlite"
import {
  assertSchemaSnapshot,
  canonicalizeCompleteSchemaSnapshot,
  completeSchemaSnapshotFingerprint,
} from "qubu/snapshot"
import type { SchemaSnapshot, SchemaSnapshotInput, SnapshotJsonValue } from "qubu/snapshot"

const metadataTable = "__qubu_migration_metadata"
const appliedTable = "__qubu_migration_applied"
const attemptsTable = "__qubu_migration_attempts"
const checkpointsTable = "__qubu_migration_checkpoints"
const reconciliationsTable = "__qubu_migration_reconciliations"
const leaseTable = "__qubu_migration_lease"
const checkpointUniqueIndex = "__qubu_migration_checkpoints_unique"
const defaultLeasePollMilliseconds = 10

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
}

export interface LibsqlMigrationAdapter extends MigrationAdapter {
  readonly client: Client
}

/** Execute single-phase migrations through the application-owned client's atomic migrate API. */
export function libsqlMigrationAdapter(
  client: Client,
  options: LibsqlMigrationAdapterOptions = {},
): LibsqlMigrationAdapter {
  if (
    !Number.isFinite(options.leasePollMilliseconds ?? defaultLeasePollMilliseconds) ||
    (options.leasePollMilliseconds ?? defaultLeasePollMilliseconds) < 0
  )
    throw new TypeError("leasePollMilliseconds must be a non-negative finite number")

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
    session: "atomic-batch",
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
  #transaction: Transaction | undefined
  #leased = false
  #closed = false
  #ddlLock = false
  #expectedSnapshot: SchemaSnapshot | undefined

  constructor(client: Client, options: LibsqlMigrationAdapterOptions) {
    this.#client = client
    this.#options = options
    this.journal = new LibsqlMigrationJournal(
      client,
      () => this.#executor(),
      () => this.#transaction,
    )
  }

  validateBatch(artifact: ExecutableMigrationArtifact): void {
    if (!artifact.beforeSnapshot.value)
      throw batchCapability("libSQL batches require an embedded before snapshot")
    if (artifact.program.phases.length !== 1)
      throw batchCapability("libSQL batch migrations require exactly one phase")
    const phase = artifact.program.phases[0]!
    if (phase.transaction === "forbidden" || phase.lock === "shared")
      throw batchCapability(
        "libSQL batch migrations require transactional execution without a shared lock",
      )
    for (const condition of phase.preconditions) {
      if (isSnapshotCondition(condition)) {
        if (
          !snapshotCondition(
            condition,
            artifact.beforeSnapshot.value,
            artifact.beforeSnapshot.digest,
          )
        )
          throw batchCapability(
            `Precondition ${condition.id} does not match the embedded before snapshot`,
          )
      } else conditionSql(condition)
    }
    for (const condition of phase.postconditions) conditionSql(condition)
    // Transaction control and connection settings belong to migrate(), not program statements.
    for (const statement of phase.statements) {
      const sql = statement.sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, " ").trim()
      if (/^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|PRAGMA|ATTACH|DETACH|VACUUM)\b/i.test(sql))
        throw batchCapability(
          "libSQL batch programs cannot contain transaction or connection control statements",
        )
    }
  }

  async applyBatch({
    artifact,
    attemptId,
    expectedHead,
    appliedAt,
  }: MigrationBatch): Promise<void> {
    this.#open()
    this.validateBatch(artifact)
    if (!this.#leased || this.#transaction)
      throw batchCapability("A batch requires the migration lease and no active transaction")
    const phase = artifact.program.phases[0]!
    const beforeSnapshot = artifact.beforeSnapshot.value!
    // Read the catalog and managed snapshot from one consistent read transaction. The batch
    // checks the same catalog before DDL so preparation never authorizes a stale schema.
    const reader = await this.#client.transaction("read")
    let catalog: string
    try {
      catalog = String((await reader.execute(catalogSql)).rows[0]![0])
      const snapshot = normalizeSnapshot(
        await (this.#options.readSnapshot ?? readLibsqlMigrationSnapshot)(reader, beforeSnapshot),
      )
      const matches = isSha256Digest(snapshot)
        ? snapshot === artifact.beforeSnapshot.digest
        : compareManagedSnapshots(beforeSnapshot, snapshot.snapshot).matches
      if (!matches)
        throw new MigrationExecutionError(
          "drift",
          "Live schema does not match the migration before snapshot",
          {},
          { retry: "safe" },
        )
    } finally {
      try {
        await reader.rollback()
      } finally {
        reader.close()
      }
    }
    const guard = `__qubu_migration_guard_${crypto.randomUUID().replaceAll("-", "")}`
    const statements: InStatement[] = [
      `CREATE TEMP TABLE ${guard} (ok INTEGER NOT NULL CHECK (ok = 1))`,
    ]
    const assertSql = (predicate: string, args: InValue[] = []) => {
      statements.push({
        sql: `INSERT INTO ${guard} VALUES (CASE WHEN (${predicate}) THEN 1 ELSE 0 END)`,
        args,
      })
    }
    assertSql(`EXISTS (SELECT 1 FROM ${leaseTable} WHERE singleton = 1 AND owner = ?)`, [
      this.#leaseToken,
    ])
    assertSql(`EXISTS (SELECT 1 FROM ${metadataTable} WHERE singleton = 1 AND head IS ?)`, [
      expectedHead,
    ])
    assertSql(`EXISTS (SELECT 1 FROM ${attemptsTable} WHERE id = ? AND state = 'running')`, [
      attemptId,
    ])
    assertSql(`(${catalogSql}) = ?`, [catalog])
    for (const condition of phase.preconditions) {
      if (isSnapshotCondition(condition)) {
        if (!snapshotCondition(condition, beforeSnapshot, artifact.beforeSnapshot.digest))
          throw new MigrationExecutionError(
            "drift",
            `Precondition ${condition.id} failed`,
            {},
            { retry: "safe" },
          )
      } else {
        const check = conditionSql(condition)
        assertSql(check.sql, check.args)
      }
    }
    for (const statement of phase.statements)
      statements.push({ sql: statement.sql, args: statement.parameters.map(decodeParameter) })
    for (const condition of phase.postconditions) {
      const check = conditionSql(condition)
      assertSql(check.sql, check.args)
    }
    // migrate() turns FK enforcement off. A failing assertion makes violations roll back
    // before the journal can claim the migration was applied.
    assertSql("NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check)")
    statements.push(
      {
        sql: `INSERT INTO ${appliedTable} (artifact_id, sequence, artifact_digest, parent_artifact_digest, kind, attempt_id, applied_at) VALUES (?, ?, ?, ?, 'migration', ?, ?)`,
        args: [
          artifact.id,
          artifact.sequence,
          artifact.artifactDigest,
          expectedHead,
          attemptId,
          appliedAt,
        ],
      },
      {
        sql: `UPDATE ${metadataTable} SET head = ? WHERE singleton = 1 AND head IS ?`,
        args: [artifact.artifactDigest, expectedHead],
      },
    )
    assertSql("changes() = 1")
    statements.push({
      sql: `UPDATE ${attemptsTable} SET state = 'applied', updated_at = ? WHERE id = ? AND state = 'running'`,
      args: [appliedAt, attemptId],
    })
    assertSql("changes() = 1")
    statements.push(
      {
        sql: `INSERT INTO ${checkpointsTable} (attempt_id, phase_id, statement_id, status, recorded_at) VALUES (?, ?, NULL, 'completed', ?)`,
        args: [attemptId, phase.id, appliedAt],
      },
      `DROP TABLE ${guard}`,
    )
    await this.#client.migrate(statements)
  }

  async acquireLease(signal?: AbortSignal): Promise<void> {
    this.#open()
    while (!this.#leased) {
      signal?.throwIfAborted()
      try {
        await this.#client.execute({
          sql: `INSERT INTO ${leaseTable} (singleton, owner) VALUES (1, ?)`,
          args: [this.#leaseToken],
        })
        this.#leased = true
      } catch (error) {
        const owner = await leaseOwner(this.#client)
        if (owner === this.#leaseToken) {
          this.#leased = true
        } else if (typeof owner !== "string") {
          throw error
        } else {
          await delay(this.#options.leasePollMilliseconds ?? defaultLeasePollMilliseconds, signal)
        }
      }
    }
  }

  async releaseLease(): Promise<void> {
    if (!this.#leased) return
    await this.#client.execute({
      sql: `DELETE FROM ${leaseTable} WHERE singleton = 1 AND owner = ?`,
      args: [this.#leaseToken],
    })
    this.#leased = false
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
    this.#transaction = await this.#client.transaction("write")
  }

  async commitTransaction(): Promise<void> {
    const transaction = this.#requiredTransaction()
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
    if (boundary === "execute-batch") {
      if (error instanceof MigrationExecutionError) return "before-execution"
      const code = failureCode(error)
      // A batch includes COMMIT. Storage/transport failures may hide its outcome;
      // only statement/constraint and lock failures prove the batch did not commit.
      return code === "SQLITE_ERROR" ||
        code?.startsWith("SQLITE_CONSTRAINT") ||
        code?.startsWith("SQLITE_BUSY") ||
        code?.startsWith("SQLITE_LOCKED")
        ? "definite-failure"
        : "uncertain"
    }
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
    return this.#transaction ?? this.#client
  }
  #requiredTransaction(): Transaction {
    this.#open()
    if (!this.#transaction) throw new Error("No migration transaction is active")
    return this.#transaction
  }
  #open(): void {
    if (this.#closed) throw new Error("Migration session is closed")
  }
}

class LibsqlMigrationJournal implements MigrationJournal {
  constructor(
    readonly client: Client,
    readonly executor: () => Executor,
    readonly transaction: () => Transaction | undefined,
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
      return this.appendAndAdvance(active, value, expected)
    }

    const transaction = await this.client.transaction("write")
    try {
      const advanced = await this.appendAndAdvance(transaction, value, expected)
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

async function initializeJournal(client: Client): Promise<void> {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS ${metadataTable} (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), format TEXT NOT NULL, version INTEGER NOT NULL, head TEXT)`,
      `CREATE TABLE IF NOT EXISTS ${appliedTable} (artifact_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE, artifact_digest TEXT NOT NULL UNIQUE, parent_artifact_digest TEXT, kind TEXT NOT NULL CHECK (kind IN ('migration', 'baseline')), attempt_id TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS ${attemptsTable} (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, artifact_digest TEXT NOT NULL, expected_head TEXT, state TEXT NOT NULL CHECK (state IN ('started', 'running', 'applied', 'rolled_back', 'recovery_required')), started_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT)`,
      `CREATE TABLE IF NOT EXISTS ${checkpointsTable} (attempt_id TEXT NOT NULL, phase_id TEXT NOT NULL, statement_id TEXT, status TEXT NOT NULL CHECK (status IN ('started', 'completed')), recorded_at TEXT NOT NULL)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS ${checkpointUniqueIndex} ON ${checkpointsTable} (attempt_id, phase_id, COALESCE(statement_id, ''), status)`,
      `CREATE TABLE IF NOT EXISTS ${reconciliationsTable} (attempt_id TEXT PRIMARY KEY, outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'rolled_back')), reason TEXT NOT NULL, reconciled_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS ${leaseTable} (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), owner TEXT NOT NULL)`,
      {
        sql: `INSERT OR IGNORE INTO ${metadataTable} (singleton, format, version, head) VALUES (1, ?, ?, NULL)`,
        args: [migrationJournalFormat, migrationJournalVersion],
      },
    ],
    "write",
  )
}

async function leaseOwner(client: Client): Promise<string | undefined> {
  const result = await client.execute(`SELECT owner FROM ${leaseTable} WHERE singleton = 1`)
  const owner = result.rows[0]?.owner
  return typeof owner === "string" ? owner : undefined
}

// Include every main-schema definition, including journal definitions. Data is guarded separately.
const catalogSql =
  "SELECT json_group_array(json_array(type, name, tbl_name, sql)) FROM (SELECT type, name, tbl_name, sql FROM main.sqlite_schema ORDER BY type, name)"

function batchCapability(message: string): MigrationExecutionError {
  return new MigrationExecutionError("capability", message, {}, { retry: "safe" })
}

function isSnapshotCondition(condition: ProgramCondition): boolean {
  return (
    condition.type === "snapshot-digest" ||
    condition.type === "snapshot-fingerprint" ||
    condition.type === "property-equals" ||
    (condition.type === "object-present" &&
      isMigrationPrecondition(condition.value) &&
      typeof condition.value.fingerprint === "string")
  )
}

function snapshotCondition(
  condition: ProgramCondition,
  snapshot: SchemaSnapshot,
  digest: Sha256Digest,
): boolean {
  if (condition.type === "snapshot-digest") return condition.value === digest
  if (condition.type === "snapshot-fingerprint")
    return (
      isMigrationPrecondition(condition.value) &&
      condition.value.fingerprint === completeSchemaSnapshotFingerprint(snapshot)
    )
  return evaluateMigrationPrecondition(
    canonicalizeCompleteSchemaSnapshot(snapshot),
    condition.value,
  )
}

function conditionSql(condition: ProgramCondition): { sql: string; args: InValue[] } {
  if (condition.type === "statement" && typeof condition.value === "string") {
    return { sql: `(${condition.value.trim().replace(/;$/, "")}) IS 1`, args: [] }
  }
  if (condition.type !== "object-present" && condition.type !== "object-absent")
    throw batchCapability(`Condition ${condition.type} cannot be evaluated inside a libSQL batch`)
  const value = condition.value
  if (
    !isMigrationPrecondition(value) ||
    typeof value.physicalName !== "string" ||
    value.fingerprint !== undefined
  )
    throw batchCapability(
      "Batch object conditions require a physical name and no unresolved fingerprint",
    )
  if (value.namespace !== undefined && value.namespace !== "main")
    throw batchCapability("libSQL batches support only the main database namespace")
  let query: string
  let args: InValue[]
  if (value.kind === "column") {
    const parent = value.parent as { physicalName?: string } | undefined
    if (typeof parent?.physicalName !== "string")
      throw batchCapability("Column conditions require the parent table's physical name")
    query = "SELECT 1 FROM pragma_table_xinfo(?, 'main') WHERE name = ?"
    args = [parent.physicalName, value.physicalName]
  } else {
    if (!["table", "view", "index", "trigger"].includes(String(value.kind)))
      throw batchCapability(
        `Object kind ${String(value.kind)} cannot be checked inside a libSQL batch`,
      )
    query = "SELECT 1 FROM main.sqlite_schema WHERE type = ? AND name = ?"
    args = [value.kind as string, value.physicalName]
  }
  return { sql: `${condition.type === "object-absent" ? "NOT " : ""}EXISTS (${query})`, args }
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
