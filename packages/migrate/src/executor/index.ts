export * from "./errors.ts"
export * from "./types.ts"

import type { ExecutableMigrationArtifact, MigrationProgramPhase } from "../artifact/index.ts"
import { validateMigrationProgram } from "../artifact/index.ts"
import {
  migrationJournalFormat,
  migrationJournalVersion,
  validateJournalState,
  type AppliedArtifactRecord,
  type MigrationAttempt,
  type MigrationJournal,
} from "../journal/index.ts"
import { verifyArtifactChain } from "../repository/index.ts"
import { MigrationExecutionError, safeFailure } from "./errors.ts"
import type {
  ExecuteMigrationsInput,
  MigrationAwaitBoundary,
  MigrationExecutionOptions,
  MigrationExecutionResult,
  MigrationSession,
} from "./types.ts"

export async function executeMigrations(
  input: ExecuteMigrationsInput,
): Promise<MigrationExecutionResult> {
  const options = input.options ?? {}
  const chain = await (async () => {
    try {
      await boundary(options, "verify-repository")
      return await verifyArtifactChain(input.repository)
    } catch (error) {
      if (error instanceof MigrationExecutionError) throw error
      throw new MigrationExecutionError(
        "validation",
        "Artifact repository could not be verified",
        {},
        { cause: error, retry: "safe" },
      )
    }
  })()
  if (!chain.ok)
    throw new MigrationExecutionError(
      "validation",
      "Artifact repository validation failed",
      {},
      { retry: "safe" },
    )

  let session: MigrationSession | undefined
  let leased = false
  let result: MigrationExecutionResult | undefined
  let primary: unknown
  try {
    await boundary(options, "open-session")
    session = await input.adapter.openMigrationSession(options.signal)
    assertNotAborted(options.signal)
    capabilityPreflight(session, chain.artifacts)
    await boundary(options, "acquire-lease")
    await session.acquireLease(options.signal)
    leased = true

    const metadata = await at(options, "read-metadata", () => session!.journal.readMetadata())
    const applied = await at(options, "list-applied", () => session!.journal.listApplied())
    const attempts = await at(options, "list-attempts", () => session!.journal.listAttempts())
    const journalDiagnostics = validateJournalState(metadata, applied, attempts)
    if (journalDiagnostics.length)
      throw new MigrationExecutionError(
        journalDiagnostics.some((item) => item.code === "recovery-required")
          ? "recovery-required"
          : "validation",
        journalDiagnostics[0]!.message,
        {},
        { retry: "safe" },
      )
    validateJournalPrefix(chain.artifacts, applied)

    const pending = chain.artifacts.slice(applied.length)
    if (pending.some((artifact) => artifact.format !== "qubu-executable-migration"))
      throw new MigrationExecutionError(
        "policy",
        "A pending baseline cannot be executed",
        {},
        { retry: "safe" },
      )
    const executable = pending as readonly ExecutableMigrationArtifact[]
    const completed = []
    let head = metadata.head
    for (const artifact of executable) {
      assertNotAborted(options.signal)
      const actual = await at(options, "read-snapshot", () => session!.currentSnapshotDigest())
      if (actual !== artifact.beforeSnapshot.digest)
        throw new MigrationExecutionError(
          "drift",
          "Live schema does not match the migration before snapshot",
          { artifactId: artifact.id, artifactDigest: artifact.artifactDigest },
          { retry: "safe" },
        )
      const appliedResult = await executeArtifact(session, artifact, head, options)
      completed.push(appliedResult)
      head = artifact.artifactDigest
    }
    result = Object.freeze({
      applied: Object.freeze(completed),
      head,
      idempotent: executable.length === 0,
    })
  } catch (error) {
    primary = error
  } finally {
    if (session && leased) {
      try {
        await at(options, "release-lease", () => session!.releaseLease())
      } catch (error) {
        primary ??= wrapAdapter(error, "Failed to release migration lease")
      }
    }
    if (session) {
      try {
        await at(options, "close-session", () => session!.close())
      } catch (error) {
        primary ??= wrapAdapter(error, "Failed to close migration session")
      }
    }
  }
  if (primary) throw wrapAdapter(primary, "Migration adapter operation failed")
  return result!
}

async function executeArtifact(
  session: MigrationSession,
  artifact: ExecutableMigrationArtifact,
  expectedHead: AppliedArtifactRecord["parentArtifactDigest"],
  options: MigrationExecutionOptions,
) {
  const diagnostics = validateMigrationProgram(artifact.program, artifact.plan)
  if (diagnostics.length)
    throw new MigrationExecutionError(
      "validation",
      "Migration program validation failed",
      { artifactId: artifact.id },
      { retry: "safe" },
    )
  const now = options.now ?? (() => new Date().toISOString())
  const attemptId = options.createAttemptId?.(artifact) ?? `${artifact.id}:${crypto.randomUUID()}`
  const startedAt = now()
  const attempt: MigrationAttempt = {
    id: attemptId,
    artifactId: artifact.id,
    artifactDigest: artifact.artifactDigest,
    expectedHead,
    state: "started",
    startedAt,
    updatedAt: startedAt,
  }
  await at(options, "create-attempt", () => session.journal.createAttempt(attempt))
  await at(options, "transition-running", () =>
    session.journal.transitionAttempt(attemptId, "running"),
  )
  let mayHaveEffect = false
  let activeTransaction = false
  let rolledBack = false
  let activeLock: Exclude<MigrationProgramPhase["lock"], "none"> | undefined
  let context = { artifactId: artifact.id, artifactDigest: artifact.artifactDigest, attemptId }
  try {
    for (const phase of artifact.program.phases) {
      context = { ...context, phaseId: phase.id } as typeof context
      assertNotAborted(options.signal, context)
      if (phase.lock !== "none") {
        await at(options, "acquire-ddl-lock", () =>
          session.acquireDdlLock(phase.lock as Exclude<typeof phase.lock, "none">, options.signal),
        )
        activeLock = phase.lock
      }
      const useTransaction =
        phase.transaction === "required" ||
        (phase.transaction === "optional" && session.capabilities.optionalTransactions)
      if (useTransaction) {
        await at(options, "begin-transaction", () => session.beginTransaction())
        activeTransaction = true
      }
      try {
        for (const condition of phase.preconditions)
          if (!(await at(options, "precondition", () => session.checkCondition(condition))))
            throw new MigrationExecutionError(
              "drift",
              `Precondition ${condition.id} failed`,
              context,
              { retry: !mayHaveEffect ? "safe" : "never" },
            )
        await at(options, "checkpoint-phase-started", () =>
          session.journal.checkpoint({
            attemptId,
            phaseId: phase.id,
            status: "started",
            recordedAt: now(),
          }),
        )
        for (const statement of phase.statements) {
          context = { ...context, statementId: statement.id } as typeof context
          await boundary(options, "execute-statement")
          try {
            await session.execute(statement.sql, statement.parameters)
            mayHaveEffect = true
          } catch (error) {
            throw classifyExecutionFailure(session, error, context)
          }
          await at(options, "checkpoint-statement", () =>
            session.journal.checkpoint({
              attemptId,
              phaseId: phase.id,
              statementId: statement.id,
              status: "completed",
              recordedAt: now(),
            }),
          )
        }
        for (const condition of phase.postconditions)
          if (!(await at(options, "postcondition", () => session.checkCondition(condition))))
            throw new MigrationExecutionError(
              "drift",
              `Postcondition ${condition.id} failed`,
              context,
            )
        await at(options, "checkpoint-phase", () =>
          session.journal.checkpoint({
            attemptId,
            phaseId: phase.id,
            status: "completed",
            recordedAt: now(),
          }),
        )
        const final = phase.position === artifact.program.phases.length - 1
        if (final) {
          await recordApplied(session.journal, artifact, attemptId, expectedHead, now, options)
          await at(options, "transition-attempt", () =>
            session.journal.transitionAttempt(attemptId, "applied"),
          )
        }
        if (activeTransaction) {
          try {
            await at(options, "commit-transaction", () => session.commitTransaction())
            activeTransaction = false
          } catch (error) {
            if (session.classifyFailure(error, "commit-transaction") === "uncertain") {
              activeTransaction = false
              throw new MigrationExecutionError(
                "uncertain-outcome",
                "Transaction commit outcome is uncertain",
                context,
                { cause: error },
              )
            }
            throw error
          }
        }
      } finally {
        if (activeLock) {
          await at(options, "release-ddl-lock", () => session.releaseDdlLock(activeLock!))
          activeLock = undefined
        }
      }
    }
    return Object.freeze({
      artifactId: artifact.id,
      artifactDigest: artifact.artifactDigest,
      attemptId,
      atomicity: atomicity(artifact),
    })
  } catch (error) {
    let finalError = error
    if (activeTransaction) {
      try {
        await at(options, "rollback-transaction", () => session.rollbackTransaction())
        activeTransaction = false
        rolledBack = true
      } catch (rollbackError) {
        finalError = new MigrationExecutionError(
          "uncertain-outcome",
          "Transaction rollback outcome is uncertain",
          context,
          { cause: rollbackError },
        )
      }
    }
    const uncertain =
      finalError instanceof MigrationExecutionError && finalError.code === "uncertain-outcome"
    const state = uncertain || (mayHaveEffect && !rolledBack) ? "recovery_required" : "rolled_back"
    try {
      await at(options, "transition-attempt", () =>
        session.journal.transitionAttempt(attemptId, state, safeFailure(finalError, context)),
      )
    } catch {
      /* preserve primary failure */
    }
    if (!(finalError instanceof MigrationExecutionError)) {
      throw new MigrationExecutionError(
        state === "rolled_back" ? "definite-rollback" : "recovery-required",
        state === "rolled_back"
          ? "Migration was rolled back"
          : "Migration requires explicit recovery",
        context,
        { cause: finalError },
      )
    }
    throw finalError
  }
}

async function recordApplied(
  journal: MigrationJournal,
  artifact: ExecutableMigrationArtifact,
  attemptId: string,
  expectedHead: AppliedArtifactRecord["parentArtifactDigest"],
  now: () => string,
  options: MigrationExecutionOptions,
): Promise<void> {
  await boundary(options, "append-history")
  await boundary(options, "head-cas")
  const advanced = await journal.appendAppliedAndAdvanceHead(
    {
      artifactId: artifact.id,
      sequence: artifact.sequence,
      artifactDigest: artifact.artifactDigest,
      parentArtifactDigest: artifact.parentArtifactDigest,
      kind: "migration",
      attemptId,
      appliedAt: now(),
    },
    expectedHead,
  )
  if (!advanced)
    throw new MigrationExecutionError(
      "concurrency",
      "Journal head changed while applying migration",
      { artifactId: artifact.id, attemptId },
    )
}

function capabilityPreflight(
  session: MigrationSession,
  artifacts: readonly {
    dialect: { name: string }
    constraints?: { minimumServerVersion?: string; requiredCapabilities?: readonly string[] }
    format: string
    program?: ExecutableMigrationArtifact["program"]
  }[],
): void {
  if (!session.capabilities.lease)
    throw new MigrationExecutionError(
      "capability",
      "Adapter does not provide a migrator lease",
      {},
      { retry: "safe" },
    )
  for (const artifact of artifacts) {
    if (artifact.dialect.name !== session.capabilities.dialect)
      throw new MigrationExecutionError(
        "capability",
        `Adapter dialect ${session.capabilities.dialect} cannot execute ${artifact.dialect.name}`,
        {},
        { retry: "safe" },
      )
    if (
      artifact.constraints?.minimumServerVersion &&
      (!session.capabilities.serverVersion ||
        compareVersions(
          session.capabilities.serverVersion,
          artifact.constraints.minimumServerVersion,
        ) < 0)
    )
      throw new MigrationExecutionError(
        "capability",
        `Adapter server version does not satisfy ${artifact.constraints.minimumServerVersion}`,
        {},
        { retry: "safe" },
      )
    for (const feature of artifact.constraints?.requiredCapabilities ?? [])
      if (!session.capabilities.features?.includes(feature))
        throw new MigrationExecutionError(
          "capability",
          `Adapter lacks required capability ${feature}`,
          {},
          { retry: "safe" },
        )
    for (const phase of artifact.program?.phases ?? []) {
      if (phase.transaction === "required" && !session.capabilities.transactionalDdl)
        throw new MigrationExecutionError(
          "capability",
          "Required transactional DDL is not supported",
          {},
          { retry: "safe" },
        )
      if (phase.lock !== "none" && !session.capabilities.locks.includes(phase.lock))
        throw new MigrationExecutionError(
          "capability",
          `DDL lock ${phase.lock} is not supported`,
          {},
          { retry: "safe" },
        )
    }
  }
}

function compareVersions(actual: string, required: string): number {
  const left = actual.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  const right = required.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a === b) continue
    if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1
    return String(a) < String(b) ? -1 : 1
  }
  return 0
}

function validateJournalPrefix(
  repository: readonly { id: string; artifactDigest: string; sequence: number }[],
  applied: readonly AppliedArtifactRecord[],
): void {
  for (let index = 0; index < applied.length; index++) {
    const expected = repository[index]
    const actual = applied[index]!
    if (
      !expected ||
      expected.id !== actual.artifactId ||
      expected.artifactDigest !== actual.artifactDigest ||
      expected.sequence !== actual.sequence
    )
      throw new MigrationExecutionError(
        "validation",
        "Journal history is not a prefix of the repository",
        { artifactId: actual.artifactId },
        { retry: "safe" },
      )
  }
}

function classifyExecutionFailure(
  session: MigrationSession,
  error: unknown,
  context: object,
): MigrationExecutionError {
  const classification = session.classifyFailure(error, "execute-statement")
  return new MigrationExecutionError(
    classification === "uncertain" ? "uncertain-outcome" : "adapter",
    classification === "uncertain"
      ? "Statement outcome is uncertain"
      : "Statement execution failed",
    context,
    { cause: error, retry: classification === "before-execution" ? "safe" : "never" },
  )
}

function atomicity(artifact: ExecutableMigrationArtifact): "atomic" | "checkpointed" | "mixed" {
  const requirements = new Set(artifact.program.phases.map((phase) => phase.transaction))
  if (requirements.size > 1) return "mixed"
  return requirements.has("required") ? "atomic" : "checkpointed"
}

async function at<T>(
  options: MigrationExecutionOptions,
  name: MigrationAwaitBoundary,
  action: () => Promise<T>,
): Promise<T> {
  await boundary(options, name)
  return action()
}
async function boundary(
  options: MigrationExecutionOptions,
  name: MigrationAwaitBoundary,
): Promise<void> {
  assertNotAborted(options.signal)
  await options.onBoundary?.(name)
  assertNotAborted(options.signal)
}
function assertNotAborted(signal?: AbortSignal, context: object = {}): void {
  if (signal?.aborted) throw new MigrationExecutionError("aborted", "Migration aborted", context)
}
function wrapAdapter(error: unknown, message: string): MigrationExecutionError {
  return error instanceof MigrationExecutionError
    ? error
    : new MigrationExecutionError("adapter", message, {}, { cause: error })
}

/** Explicitly resolve a blocked attempt after application-owned live verification. */
export interface ReconcileAttemptInput {
  readonly journal: MigrationJournal
  readonly attemptId: string
  readonly outcome: "applied" | "rolled_back"
  readonly reason: string
  /** Application-owned live verification of the selected outcome. */
  readonly verify: () => Promise<boolean>
  readonly artifact?: ExecutableMigrationArtifact
  readonly now?: () => string
}

export async function reconcileAttempt(input: ReconcileAttemptInput): Promise<void> {
  const { journal, attemptId, outcome, reason } = input
  const now = input.now ?? (() => new Date().toISOString())
  if (!reason.trim())
    throw new MigrationExecutionError("recovery-required", "Reconciliation requires a reason")
  const attempt = (await journal.listAttempts()).find((item) => item.id === attemptId)
  if (!attempt || attempt.state === "applied" || attempt.state === "rolled_back")
    throw new MigrationExecutionError(
      "recovery-required",
      "Only recovery-required attempts can be reconciled",
    )
  if (!(await input.verify()))
    throw new MigrationExecutionError(
      "recovery-required",
      "Live verification did not prove the selected outcome",
    )
  if (attempt.state !== "recovery_required") {
    await journal.transitionAttempt(attempt.id, "recovery_required")
  }
  if (outcome === "rolled_back") {
    const existing = (await journal.listApplied()).some((record) => record.attemptId === attempt.id)
    if (existing)
      throw new MigrationExecutionError(
        "recovery-required",
        "An attempt with immutable applied history cannot be reconciled as rolled back",
      )
  }
  if (outcome === "applied") {
    const artifact = input.artifact
    if (
      !artifact ||
      artifact.artifactDigest !== attempt.artifactDigest ||
      artifact.id !== attempt.artifactId
    )
      throw new MigrationExecutionError(
        "recovery-required",
        "Applied reconciliation requires the exact artifact",
      )
    const existing = (await journal.listApplied()).find(
      (record) => record.artifactDigest === artifact.artifactDigest,
    )
    if (!existing) {
      if (
        !(await journal.appendAppliedAndAdvanceHead(
          {
            artifactId: artifact.id,
            sequence: artifact.sequence,
            artifactDigest: artifact.artifactDigest,
            parentArtifactDigest: artifact.parentArtifactDigest,
            kind: "migration",
            attemptId,
            appliedAt: now(),
          },
          attempt.expectedHead,
        ))
      )
        throw new MigrationExecutionError(
          "concurrency",
          "Journal head changed during reconciliation",
          { artifactId: artifact.id, attemptId },
        )
    } else if ((await journal.readMetadata()).head !== artifact.artifactDigest) {
      throw new MigrationExecutionError(
        "validation",
        "Applied record exists but is not the journal head",
        { artifactId: artifact.id, attemptId },
      )
    }
  }
  await journal.recordReconciliation({ attemptId, outcome, reason, reconciledAt: now() })
  await journal.transitionAttempt(attemptId, outcome)
}

export async function inspectRecovery(
  journal: MigrationJournal,
): Promise<readonly MigrationAttempt[]> {
  return Object.freeze(
    (await journal.listAttempts()).filter(
      (attempt) =>
        attempt.state === "started" ||
        attempt.state === "running" ||
        attempt.state === "recovery_required",
    ),
  )
}

export function emptyJournalMetadata() {
  return Object.freeze({
    format: migrationJournalFormat,
    version: migrationJournalVersion,
    head: null,
  })
}
