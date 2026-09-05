import type { SchemaSnapshot } from "qubu/snapshot"

import type {
  ExecutableMigrationArtifact,
  ProgramCondition,
  ProgramLockRequirement,
  ProgramTransactionRequirement,
  Sha256Digest,
  TaggedParameterValue,
} from "../artifact/index.ts"
import type { MigrationJournal } from "../journal/index.ts"
import type { ArtifactRepository } from "../repository/index.ts"

export type MigrationSnapshot = SchemaSnapshot

export interface MigrationSnapshotInspection {
  readonly snapshot: MigrationSnapshot
  readonly unmanagedObjects: readonly {
    readonly kind: string
    readonly physicalName: string
  }[]
}

export interface MigrationAdapterCapabilities {
  readonly dialect: string
  readonly serverVersion?: string
  /** Batch profiles pin only the atomic batch, not calls made while preparing it. */
  readonly session: "pinned" | "atomic-batch"
  readonly transactionalDdl: boolean
  readonly optionalTransactions: boolean
  /** Transaction requirements this adapter has proven it can execute safely. */
  readonly transactions?: readonly ProgramTransactionRequirement[]
  readonly lease: boolean
  readonly leaseKind: "database"
  readonly locks: readonly ProgramLockRequirement[]
  readonly journal: {
    readonly storage: "database"
    readonly compareAndSwapHead: true
    readonly atomicAppliedAndHead: true
  }
  readonly parameters: readonly TaggedParameterValue["type"][]
  readonly commitAmbiguity: "recovery-required"
  readonly forbiddenPhases: "checkpointed" | "unsupported"
  readonly features?: readonly string[]
}

export type AdapterFailureClassification = "before-execution" | "definite-failure" | "uncertain"

/** Migration resources; the capability profile declares whether execution is pinned or batched. */
export interface MigrationSession {
  readonly capabilities: MigrationAdapterCapabilities
  readonly journal: MigrationJournal
  /** Required for atomic-batch profiles. Validate support before creating an attempt. */
  validateBatch?(artifact: ExecutableMigrationArtifact): void
  /** Atomically enforce checks, execute one phase, append history, advance head and mark applied. */
  applyBatch?(input: MigrationBatch): Promise<void>
  acquireLease(signal?: AbortSignal): Promise<void>
  releaseLease(): Promise<void>
  acquireDdlLock(
    requirement: Exclude<ProgramLockRequirement, "none">,
    signal?: AbortSignal,
  ): Promise<void>
  releaseDdlLock(requirement: Exclude<ProgramLockRequirement, "none">): Promise<void>
  beginTransaction(): Promise<void>
  commitTransaction(): Promise<void>
  rollbackTransaction(): Promise<void>
  execute(sql: string, parameters: readonly TaggedParameterValue[]): Promise<void>
  checkCondition(condition: ProgramCondition): Promise<boolean>
  /** Strict managed-schema inspection, when supported by the adapter profile. */
  readSnapshot?(expected?: MigrationSnapshot): Promise<MigrationSnapshotInspection>
  currentSnapshotDigest(expected?: MigrationSnapshot): Promise<Sha256Digest>
  close(): Promise<void>
  classifyFailure(error: unknown, boundary: MigrationAwaitBoundary): AdapterFailureClassification
}

/** One atomic artifact application, including its terminal journal writes. */
export interface MigrationBatch {
  readonly artifact: ExecutableMigrationArtifact
  readonly attemptId: string
  readonly expectedHead: Sha256Digest | null
  readonly appliedAt: string
}

export interface MigrationAdapter {
  openMigrationSession(signal?: AbortSignal): Promise<MigrationSession>
}

export interface UnavailableMigrationAdapterProfile {
  readonly status: "experimental" | "incompatible" | "not-yet-written"
  readonly reason: string
  readonly missingCapabilities: readonly (
    | "pinned-session"
    | "transaction-control"
    | "migrator-lease"
    | "ddl-lock"
    | "journal-head-cas"
    | "commit-ambiguity"
    | "forbidden-phases"
  )[]
}

export type MigrationAwaitBoundary =
  | "verify-repository"
  | "open-session"
  | "acquire-lease"
  | "read-metadata"
  | "list-applied"
  | "list-attempts"
  | "read-snapshot"
  | "create-attempt"
  | "transition-running"
  | "acquire-ddl-lock"
  | "begin-transaction"
  | "precondition"
  | "checkpoint-phase-started"
  | "execute-statement"
  | "execute-batch"
  | "checkpoint-statement"
  | "postcondition"
  | "checkpoint-phase"
  | "append-history"
  | "head-cas"
  | "commit-transaction"
  | "rollback-transaction"
  | "transition-attempt"
  | "release-ddl-lock"
  | "release-lease"
  | "close-session"

export interface MigrationExecutionOptions {
  readonly signal?: AbortSignal
  readonly now?: () => string
  readonly createAttemptId?: (artifact: ExecutableMigrationArtifact) => string
  readonly onBoundary?: (boundary: MigrationAwaitBoundary) => void | Promise<void>
}

export interface AppliedMigrationResult {
  readonly artifactId: string
  readonly artifactDigest: Sha256Digest
  readonly attemptId: string
  readonly atomicity: "atomic" | "checkpointed" | "mixed"
}

export interface MigrationExecutionResult {
  readonly applied: readonly AppliedMigrationResult[]
  readonly head: Sha256Digest | null
  readonly idempotent: boolean
}

export interface ExecuteMigrationsInput {
  readonly repository: ArtifactRepository | readonly (string | unknown)[]
  readonly adapter: MigrationAdapter
  readonly options?: MigrationExecutionOptions
}
