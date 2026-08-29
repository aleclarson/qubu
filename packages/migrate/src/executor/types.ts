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

export interface MigrationAdapterCapabilities {
  readonly dialect: string
  readonly serverVersion?: string
  readonly transactionalDdl: boolean
  readonly optionalTransactions: boolean
  /** Transaction requirements this adapter has proven it can execute safely. */
  readonly transactions?: readonly ProgramTransactionRequirement[]
  readonly lease: boolean
  readonly locks: readonly ProgramLockRequirement[]
  readonly features?: readonly string[]
}

export type AdapterFailureClassification = "before-execution" | "definite-failure" | "uncertain"

/** One pinned database connection/session for the complete migration lifecycle. */
export interface MigrationSession {
  readonly capabilities: MigrationAdapterCapabilities
  readonly journal: MigrationJournal
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
  currentSnapshotDigest(): Promise<Sha256Digest>
  close(): Promise<void>
  classifyFailure(error: unknown, boundary: MigrationAwaitBoundary): AdapterFailureClassification
}

export interface MigrationAdapter {
  openMigrationSession(signal?: AbortSignal): Promise<MigrationSession>
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
