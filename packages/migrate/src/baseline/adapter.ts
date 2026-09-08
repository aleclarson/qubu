import type { VerifiedBaselineArtifact } from "../artifact/index.ts"
import type { MigrationSnapshot, MigrationSnapshotInspection } from "../executor/types.ts"

/** Driver-owned resources for one adoption operation, independent of migration execution. */
export interface BaselineSession {
  readonly dialect: string
  /** Inspect actual catalog facts in the original managed scope. */
  readSnapshot(scope: MigrationSnapshot): Promise<MigrationSnapshotInspection>
  /** Reject existing or invalid history, including any recorded interrupted attempts. */
  assertEmptyHistory(): Promise<void>
  /** Durably record a non-executable baseline. The adapter owns atomicity and failure handling. */
  recordBaseline(artifact: VerifiedBaselineArtifact, attemptId: string): Promise<void>
  /** Release coordination and session resources, even after failed inspection or recording. */
  close(): Promise<void>
}

/**
 * Open a session ready for inspection and recording, with history setup and coordination in place.
 * The adapter must document connection ownership and whether exclusion is database-backed or
 * caller-managed. Failed opening must clean up resources before rejecting.
 */
export interface BaselineAdapter {
  openBaselineSession(scope: MigrationSnapshot, signal?: AbortSignal): Promise<BaselineSession>
}
