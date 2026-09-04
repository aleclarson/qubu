import type {
  SnapshotDiff,
  SnapshotDiffDiagnostic,
  SnapshotDiffEvidence,
  SnapshotDiffObject,
  SnapshotDiffObjectKind,
  SnapshotDiffObjectReference,
  SnapshotDiffOperationType,
  SnapshotDiffPath,
} from "qubu/diff"
import type { SnapshotDialect, SnapshotJsonValue } from "qubu/snapshot"

/** The versioned envelope tag for dialect-neutral migration plans. */
export const migrationPlanFormat = "qubu-migration-plan" as const

/** The migration-plan version that uses fingerprint terminology for FNV change detectors. */
export const migrationPlanVersion = 2 as const

/** Safety classifications carried by every planned operation. */
export type MigrationSafety = "safe" | "review-required" | "destructive" | "unsupported" | "unknown"

/** Lock strength required by a planned operation. */
export type MigrationLockRequirement = "none" | "shared" | "exclusive" | "unknown"

/** Transaction behavior required by a planned operation. */
export type MigrationTransactionRequirement = "required" | "optional" | "forbidden" | "unknown"

/** Operations that can appear in a migration plan. */
export type MigrationOperationType =
  | "add"
  | "remove"
  | "property-change"
  | "physical-rename"
  | "custom-sql"

/** A condition a later executor must check before applying an operation. */
export type MigrationPreconditionType =
  | "snapshot-fingerprint"
  | "object-present"
  | "object-absent"
  | "property-equals"

/** An immutable, serializable migration precondition. */
export interface MigrationPrecondition {
  readonly type: MigrationPreconditionType
  readonly path: SnapshotDiffPath
  readonly kind: SnapshotDiffObjectKind | "custom-sql"
  readonly namespace?: string
  readonly logicalId?: string
  readonly physicalName?: string
  readonly fingerprint?: string
  readonly property?: SnapshotDiffPath
  readonly parent?: SnapshotDiffObjectReference
  readonly value?: SnapshotJsonValue
}

/** The explicit custom SQL escape hatch for one planned operation. */
export interface MigrationCustomSql {
  readonly sql: string
  readonly dialect: SnapshotDialect
  readonly safety: MigrationSafety
  readonly position: number
  readonly reason: string
  readonly reversible: boolean
}

/** Input accepted when attaching explicit custom SQL to a plan. */
export interface MigrationCustomSqlInput {
  readonly sql: string
  readonly dialect: SnapshotDialect
  readonly safety: MigrationSafety
  readonly reason: string
  readonly reversible?: boolean
  /** Target an operation by deterministic ID when it already exists. */
  readonly operationId?: string
  /** Or target a diff object by kind, namespace, and path. */
  readonly kind?: SnapshotDiffObjectKind
  readonly namespace?: string
  readonly path?: SnapshotDiffPath
  /** Explicit dependency position. It does not render or execute SQL. */
  readonly position?: number
  readonly dependsOn?: readonly string[]
}

/** A user's explicit decision for an unsafe or incomplete fact. */
export interface MigrationDecision {
  readonly action: "allow" | "skip"
  readonly reason: string
  readonly operationId?: string
  readonly kind?: SnapshotDiffObjectKind
  readonly namespace?: string
  readonly path?: SnapshotDiffPath
  readonly code?: MigrationDiagnosticCode
}

/** Why a plan was blocked or needs review. */
export type MigrationDiagnosticCode =
  | "decision-required"
  | "dependency-cycle"
  | "invalid-plan"
  | "unknown"
  | "lossy"
  | "unsupported"
  | "destructive"
  | "ambiguous"
  | "custom-sql"
  | "dialect-mismatch"
  | "non-canonical"

/** A structured plan diagnostic that keeps source diff context. */
export interface MigrationDiagnostic {
  readonly code: MigrationDiagnosticCode
  readonly severity: "error" | "warning"
  readonly message: string
  readonly path: SnapshotDiffPath
  readonly operationId?: string
  readonly kind?: SnapshotDiffObjectKind | "custom-sql"
  readonly namespace?: string
  readonly logicalId?: string
  readonly physicalName?: string
  readonly dialect?: SnapshotDialect
  readonly evidence?: readonly SnapshotDiffEvidence[]
  readonly source?: SnapshotDiffDiagnostic
}

/** The source facts preserved on each non-custom migration operation. */
export interface MigrationOperationOrigin {
  readonly type: SnapshotDiffOperationType
  readonly kind: SnapshotDiffObjectKind
  readonly namespace?: string
  readonly path: SnapshotDiffPath
  readonly logicalId?: string
  readonly physicalName?: string
  readonly physicalReference?: SnapshotJsonValue
  readonly provenance?: SnapshotJsonValue
  readonly before?: SnapshotDiffObject
  readonly after?: SnapshotDiffObject
  readonly evidence: readonly SnapshotDiffEvidence[]
}

/** One immutable operation in a migration plan. */
export interface MigrationOperation {
  readonly id: string
  readonly type: MigrationOperationType
  readonly kind: SnapshotDiffObjectKind | "custom-sql"
  readonly objectKind: SnapshotDiffObjectKind | "custom-sql"
  readonly namespace?: string
  readonly path: SnapshotDiffPath
  readonly logicalId?: string
  readonly physicalName?: string
  readonly physicalReference?: SnapshotJsonValue
  readonly provenance?: SnapshotJsonValue
  readonly dialect: SnapshotDialect
  readonly safety: MigrationSafety
  readonly lock: MigrationLockRequirement
  readonly transaction: MigrationTransactionRequirement
  readonly reversible: boolean
  readonly reversibility: "reversible" | "irreversible"
  readonly irreversibleReason?: string
  readonly preconditions: readonly MigrationPrecondition[]
  readonly dependsOn: readonly string[]
  readonly evidence: readonly SnapshotDiffEvidence[]
  readonly origin?: MigrationOperationOrigin
  readonly customSql?: MigrationCustomSql
  readonly decision?: MigrationDecision
  readonly status: "approved" | "decision-required" | "skipped"
  readonly position: number
}

/** A dependency edge. `from` must appear before `to`. */
export interface MigrationDependency {
  readonly from: string
  readonly to: string
  readonly reason:
    | "parent-before-child"
    | "child-before-parent"
    | "reference-before-dependent"
    | "explicit-custom-sql"
}

/** Immutable migration plan data. It contains no executor or SQL renderer. */
export interface MigrationPlan {
  readonly format: typeof migrationPlanFormat
  readonly version: typeof migrationPlanVersion
  readonly dialect: SnapshotDialect
  readonly beforeFingerprint?: string
  readonly afterFingerprint?: string
  readonly safety: MigrationSafety
  readonly ready: boolean
  readonly operations: readonly MigrationOperation[]
  readonly dependencies: readonly MigrationDependency[]
  readonly decisions: readonly MigrationDecision[]
  readonly diagnostics: readonly MigrationDiagnostic[]
}

/** Options for converting a resolved diff into a migration plan. */
export interface MigrationPlanOptions {
  readonly decisions?: readonly MigrationDecision[]
  readonly customSql?: readonly MigrationCustomSqlInput[]
  readonly allowUnknown?: boolean
  readonly allowLossy?: boolean
  readonly allowUnsupported?: boolean
  readonly allowDestructive?: boolean
  readonly allowReviewRequired?: boolean
}

/** A plan result retains a blocked plan so callers can inspect and review it. */
export type MigrationPlanResult =
  | {
      readonly ok: true
      readonly plan: MigrationPlan
      readonly diagnostics: readonly MigrationDiagnostic[]
    }
  | {
      readonly ok: false
      readonly plan: MigrationPlan
      readonly diagnostics: readonly MigrationDiagnostic[]
    }

/** Result returned by strict plan decoding. */
export type MigrationPlanDecodeResult =
  | {
      readonly ok: true
      readonly value: MigrationPlan
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly MigrationDiagnostic[]
    }

/** Result returned by non-throwing plan validation. */
export type MigrationPlanValidationResult = MigrationPlanDecodeResult

/** A validation error raised by throwing plan APIs. */
export class MigrationPlanValidationError extends TypeError {
  readonly name = "MigrationPlanValidationError"
  readonly diagnostics: readonly MigrationDiagnostic[]
  readonly issues: readonly MigrationDiagnostic[]

  constructor(diagnostics: readonly MigrationDiagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join("\n"))
    this.diagnostics = Object.freeze([...diagnostics])
    this.issues = this.diagnostics
  }
}

/** Keep the source diff type available from the migration entrypoint. */
export type { SnapshotDiff }
