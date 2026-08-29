import type {
  CompleteSchemaSnapshot,
  SchemaSnapshot,
  SnapshotDialect,
  SnapshotJsonValue,
} from "qubu/snapshot"

import type { MigrationPlan } from "../plan/index.ts"
import type { MigrationSafety } from "../plan/index.ts"
import type { Sha256Digest } from "./canonical.ts"

export const migrationProgramFormat = "qubu-migration-program" as const
export const migrationProgramVersion = 1 as const
export const executableArtifactFormat = "qubu-executable-migration" as const
export const executableArtifactVersion = 1 as const
export const baselineArtifactFormat = "qubu-verified-baseline" as const
export const baselineArtifactVersion = 1 as const

export type ProgramTransactionRequirement = "required" | "optional" | "forbidden"
export type ProgramLockRequirement = "none" | "shared" | "exclusive"

/** JSON-safe, unambiguous values bound by migration adapters. */
export type TaggedParameterValue =
  | { readonly type: "null" }
  | {
      readonly type: "boolean"
      readonly value: boolean
    }
  | {
      readonly type: "string"
      readonly value: string
    }
  | {
      readonly type: "number"
      readonly value: string
    }
  | {
      readonly type: "bigint"
      readonly value: string
    }
  | {
      readonly type: "bytes"
      readonly base64: string
    }
  | {
      readonly type: "json"
      readonly value: SnapshotJsonValue
    }

export interface ProgramCondition {
  readonly id: string
  readonly type: "object-present" | "object-absent" | "snapshot-digest" | "statement"
  readonly value: SnapshotJsonValue
}

export interface MigrationProgramStatement {
  readonly id: string
  readonly position: number
  readonly operationId: string
  readonly sql: string
  readonly parameters: readonly TaggedParameterValue[]
  readonly dependsOn: readonly string[]
}

export interface MigrationProgramPhase {
  readonly id: string
  readonly position: number
  readonly transaction: ProgramTransactionRequirement
  readonly lock: ProgramLockRequirement
  readonly dependsOn: readonly string[]
  readonly statements: readonly MigrationProgramStatement[]
  readonly preconditions: readonly ProgramCondition[]
  readonly postconditions: readonly ProgramCondition[]
}

/** Versioned authoritative executable representation. SQL summaries are deliberately absent. */
export interface MigrationProgram {
  readonly format: typeof migrationProgramFormat
  readonly version: typeof migrationProgramVersion
  readonly phases: readonly MigrationProgramPhase[]
}

export interface RendererDescriptor {
  readonly id: string
  readonly version: number
  readonly dialect: SnapshotDialect
}

export interface ArtifactConstraints {
  readonly minimumServerVersion?: string
  readonly requiredCapabilities?: readonly string[]
}

export interface OperationApproval {
  readonly operationId: string
  readonly decision: "approve" | "custom-program"
  readonly safety: MigrationSafety
  readonly findings: readonly string[]
  readonly reason: string
  readonly approvedBy?: string
  readonly approvedAt?: string
}

export interface CustomProgramProvenance {
  readonly operationId: string
  readonly source: string
  readonly reason: string
  readonly revision?: string
}

export interface CanonicalizationDescriptor {
  readonly format: "qubu-canonical-json"
  readonly version: 1
}

export interface DigestAlgorithmDescriptor {
  readonly algorithm: "sha-256"
  readonly version: 1
}

export interface ArtifactProvenance {
  readonly source: string
  readonly revision?: string
  readonly actor?: string
  readonly metadata?: SnapshotJsonValue
}

export interface SnapshotDescriptor {
  readonly digest: Sha256Digest
  readonly value?: SchemaSnapshot | CompleteSchemaSnapshot
  readonly reference?: string
}

export interface ExecutableMigrationArtifact {
  readonly format: typeof executableArtifactFormat
  readonly version: typeof executableArtifactVersion
  readonly id: string
  readonly sequence: number
  readonly parentArtifactDigest: Sha256Digest | null
  readonly canonicalization: CanonicalizationDescriptor
  readonly digestAlgorithm: DigestAlgorithmDescriptor
  readonly dialect: SnapshotDialect
  readonly constraints?: ArtifactConstraints
  readonly plan: MigrationPlan
  readonly planDigest: Sha256Digest
  readonly renderer: RendererDescriptor
  readonly program: MigrationProgram
  readonly programDigest: Sha256Digest
  readonly beforeSnapshot: SnapshotDescriptor
  readonly afterSnapshot: SnapshotDescriptor
  readonly approvals: readonly OperationApproval[]
  readonly customPrograms: readonly CustomProgramProvenance[]
  readonly provenance: ArtifactProvenance
  readonly artifactDigest: Sha256Digest
}

export interface VerifiedBaselineArtifact {
  readonly format: typeof baselineArtifactFormat
  readonly version: typeof baselineArtifactVersion
  readonly id: string
  readonly sequence: number
  readonly parentArtifactDigest: Sha256Digest | null
  readonly canonicalization: CanonicalizationDescriptor
  readonly digestAlgorithm: DigestAlgorithmDescriptor
  readonly dialect: SnapshotDialect
  readonly constraints?: ArtifactConstraints
  readonly snapshot: SnapshotDescriptor
  readonly verifiedAt: string
  readonly provenance: ArtifactProvenance
  readonly operator?: SnapshotJsonValue
  readonly artifactDigest: Sha256Digest
}

export type MigrationArtifact = ExecutableMigrationArtifact | VerifiedBaselineArtifact

export type UnsealedExecutableMigrationArtifact = Omit<
  ExecutableMigrationArtifact,
  | "canonicalization"
  | "digestAlgorithm"
  | "planDigest"
  | "programDigest"
  | "beforeSnapshot"
  | "afterSnapshot"
  | "customPrograms"
  | "artifactDigest"
> & {
  readonly beforeSnapshot: Omit<SnapshotDescriptor, "digest"> & {
    readonly digest?: Sha256Digest
  }
  readonly afterSnapshot: Omit<SnapshotDescriptor, "digest"> & {
    readonly digest?: Sha256Digest
  }
  readonly customPrograms?: readonly CustomProgramProvenance[]
}

export type UnsealedBaselineArtifact = Omit<
  VerifiedBaselineArtifact,
  "canonicalization" | "digestAlgorithm" | "snapshot" | "artifactDigest"
> & {
  readonly snapshot: Omit<SnapshotDescriptor, "digest"> & {
    readonly digest?: Sha256Digest
  }
}

export type ArtifactDiagnosticCode =
  | "invalid-json"
  | "invalid-value"
  | "unknown-key"
  | "unsupported-version"
  | "non-canonical"
  | "digest-mismatch"
  | "approval-required"
  | "duplicate"
  | "sequence-gap"
  | "parent-mismatch"
  | "fork"

export interface ArtifactDiagnostic {
  readonly code: ArtifactDiagnosticCode
  readonly path: readonly (string | number)[]
  readonly message: string
}

export type ArtifactDecodeResult<T extends MigrationArtifact = MigrationArtifact> =
  | {
      readonly ok: true
      readonly value: T
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly ArtifactDiagnostic[]
    }

export class ArtifactValidationError extends TypeError {
  readonly name = "ArtifactValidationError"
  constructor(readonly diagnostics: readonly ArtifactDiagnostic[]) {
    super(diagnostics.map((item) => `${item.path.join(".") || "$"}: ${item.message}`).join("\n"))
  }
}
