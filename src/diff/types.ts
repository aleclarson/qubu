import type {
  CompleteSchemaSnapshot,
  CompleteSnapshotObjectKind,
} from "../snapshot/complete-types.ts"
import type { SchemaSnapshot, SnapshotDialect, SnapshotJsonValue } from "../snapshot/types.ts"

/** Object families understood by the snapshot diff engine. */
export type SnapshotDiffObjectKind = CompleteSnapshotObjectKind

/** A path into a canonical snapshot or one of its object records. */
export type SnapshotDiffPath = readonly (string | number)[]

/** A stable reference to an object in a rename hint. */
export interface SnapshotRenameTarget {
  /** Stable logical ID, when the source or target snapshot has one. */
  readonly id?: string
  /** Physical name evidence used when logical IDs changed. */
  readonly physicalName?: string
  /** Optional exact object path for a repeated ID in a nested scope. */
  readonly path?: SnapshotDiffPath
}

/**
 * An explicit, serializable physical-rename mapping.
 *
 * `namespace` and `kind` are part of the key. A hint never crosses either boundary, and a hint is
 * only authoritative after both targets resolve to exactly one object.
 */
export interface SnapshotRenameHint {
  readonly namespace?: string
  readonly kind: SnapshotDiffObjectKind
  readonly from: string | SnapshotRenameTarget
  readonly to: string | SnapshotRenameTarget
}

/** Input accepted by the diff and hint helpers. */
export type SnapshotDiffInput =
  | SchemaSnapshot
  | CompleteSchemaSnapshot
  | string
  | Readonly<Record<string, unknown>>

/** Evidence attached to an object, match, operation, or diagnostic. */
export interface SnapshotDiffEvidence {
  readonly kind:
    | "logical-id"
    | "physical-name"
    | "physical-reference"
    | "provenance"
    | "dialect"
    | "canonical"
    | "explicit-hint"
    | "structural"
    | "ambiguity"
  readonly path?: SnapshotDiffPath
  readonly value?: SnapshotJsonValue
  readonly message?: string
  readonly confidence?: number
}

/** An immutable object view retained by a diff result. */
export interface SnapshotDiffObject {
  readonly kind: SnapshotDiffObjectKind
  /** The deferred or opaque kind observed by an adapter, if any. */
  readonly observedKind?: string
  readonly namespace?: string
  readonly path: SnapshotDiffPath
  readonly parent?: SnapshotDiffObjectReference
  readonly id: string
  readonly physicalName?: string
  readonly physicalReference?: SnapshotJsonValue
  readonly dialect: SnapshotDialect
  readonly provenance?: SnapshotJsonValue
  /** The original validated object record, retained as immutable data. */
  readonly value: Readonly<Record<string, SnapshotJsonValue>>
  readonly evidence: readonly SnapshotDiffEvidence[]
}

/** A logical object reference used in parent and related-object evidence. */
export interface SnapshotDiffObjectReference {
  readonly kind: SnapshotDiffObjectKind
  readonly id: string
  readonly namespace?: string
}

/** One changed property in a matched object pair. */
export interface SnapshotDiffPropertyChange {
  readonly path: SnapshotDiffPath
  readonly before?: SnapshotJsonValue
  readonly after?: SnapshotJsonValue
}

/** Categories of emitted diff operations. */
export type SnapshotDiffOperationType = "add" | "remove" | "property-change" | "physical-rename"

/** A diff operation. All variants retain both object identity and evidence. */
export interface SnapshotDiffOperation {
  readonly type: SnapshotDiffOperationType
  /** Alias for callers that use operation terminology. */
  readonly operation: SnapshotDiffOperationType
  readonly classification: SnapshotDiffOperationType
  readonly changeKind: SnapshotDiffOperationType
  readonly kind: SnapshotDiffObjectKind
  readonly objectKind: SnapshotDiffObjectKind
  readonly namespace?: string
  readonly path: SnapshotDiffPath
  readonly dialect: SnapshotDialect
  readonly physicalReference?: SnapshotJsonValue
  readonly provenance?: SnapshotJsonValue
  readonly before?: SnapshotDiffObject
  readonly after?: SnapshotDiffObject
  readonly object?: SnapshotDiffObject
  readonly logicalId?: string
  readonly physicalName?: string
  readonly changedProperties?: readonly SnapshotDiffPropertyChange[]
  readonly evidence: readonly SnapshotDiffEvidence[]
  readonly source: "stable-id" | "explicit-hint"
  readonly destructive: boolean
}

/** A conservative structural match suggestion. It is never an operation. */
export interface SnapshotRenameSuggestion {
  readonly type: "rename-suggestion"
  readonly operation: "rename-suggestion"
  readonly kind: SnapshotDiffObjectKind
  readonly objectKind: SnapshotDiffObjectKind
  readonly namespace?: string
  readonly before: SnapshotDiffObject
  readonly after: SnapshotDiffObject
  readonly confidence: number
  readonly evidence: readonly SnapshotDiffEvidence[]
}

/** Diagnostic categories emitted by snapshot comparison and hint validation. */
export type SnapshotDiffDiagnosticCode =
  | "ambiguous"
  | "destructive"
  | "unsupported"
  | "unknown"
  | "lossy"
  | "invalid-snapshot"
  | "invalid-rename-hint"
  | "rename-conflict"
  | "dialect-mismatch"

/** A path-addressed diff diagnostic with object and dialect context. */
export interface SnapshotDiffDiagnostic {
  readonly code: SnapshotDiffDiagnosticCode
  readonly category: SnapshotDiffDiagnosticCode
  readonly severity: "error" | "warning"
  readonly message: string
  readonly path: SnapshotDiffPath
  readonly relatedPaths?: readonly SnapshotDiffPath[]
  readonly kind?: SnapshotDiffObjectKind
  readonly objectKind?: SnapshotDiffObjectKind
  readonly namespace?: string
  readonly logicalId?: string
  readonly physicalName?: string
  readonly dialect?: SnapshotDialect
  readonly evidence?: readonly SnapshotDiffEvidence[]
}

/** Options controlling explicit hints and conservative suggestions. */
export interface SnapshotDiffOptions {
  /** Authoritative mappings. `renames` is accepted as an ergonomic alias. */
  readonly renameHints?: readonly SnapshotRenameHint[]
  readonly renames?: readonly SnapshotRenameHint[]
  /** Disable structural suggestions while retaining stable and explicit matches. */
  readonly suggestions?: boolean
  /** Minimum score for a unique heuristic suggestion. Defaults to 0.75. */
  readonly suggestionThreshold?: number
}

/** The complete immutable output of `diffSnapshots`. */
export interface SnapshotDiff {
  readonly equal: boolean
  readonly beforeVersion?: 1 | 2
  readonly afterVersion?: 1 | 2
  readonly beforeDialect?: SnapshotDialect
  readonly afterDialect?: SnapshotDialect
  readonly beforeFingerprint?: string
  readonly afterFingerprint?: string
  readonly operations: readonly SnapshotDiffOperation[]
  readonly changes: readonly SnapshotDiffOperation[]
  readonly additions: readonly SnapshotDiffOperation[]
  readonly removals: readonly SnapshotDiffOperation[]
  readonly propertyChanges: readonly SnapshotDiffOperation[]
  readonly renames: readonly SnapshotDiffOperation[]
  readonly added: readonly SnapshotDiffOperation[]
  readonly removed: readonly SnapshotDiffOperation[]
  readonly changed: readonly SnapshotDiffOperation[]
  readonly physicalRenames: readonly SnapshotDiffOperation[]
  readonly suggestions: readonly SnapshotRenameSuggestion[]
  readonly diagnostics: readonly SnapshotDiffDiagnostic[]
  readonly issues: readonly SnapshotDiffDiagnostic[]
  readonly renameHints: readonly SnapshotRenameHint[]
  readonly hints: readonly SnapshotRenameHint[]
}

/** Result returned by serializable rename-hint validation/decoding helpers. */
export type SnapshotRenameHintResult =
  | {
      readonly ok: true
      readonly value: readonly SnapshotRenameHint[]
      readonly diagnostics: readonly SnapshotDiffDiagnostic[]
    }
  | {
      readonly ok: false
      readonly value: readonly SnapshotRenameHint[]
      readonly diagnostics: readonly SnapshotDiffDiagnostic[]
    }

/** Decode diagnostics without throwing, suitable for editor and CLI callers. */
export type SnapshotDiffDecodeResult =
  | {
      readonly ok: true
      readonly version: 1 | 2
      readonly value: SchemaSnapshot | CompleteSchemaSnapshot
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly SnapshotDiffDiagnostic[]
    }
