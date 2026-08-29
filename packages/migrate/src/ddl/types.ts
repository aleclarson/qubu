import type { SchemaDialect } from "qubu/schema"

import type {
  MigrationLockRequirement,
  MigrationOperation,
  MigrationPlan,
  MigrationTransactionRequirement,
} from "../plan/index.ts"

/** Stable diagnostic categories produced before a migration is rendered. */
export type DdlDiagnosticCode =
  | "invalid-plan"
  | "blocked-plan"
  | "decision-required"
  | "dialect-mismatch"
  | "unsupported"
  | "server-version"
  | "lock-conflict"
  | "transaction-conflict"
  | "lossy"
  | "unknown"
  | "destructive"
  | "review-required"
  | "ambiguous"
  | "malformed-operation"
  | "custom-sql"
  | "capability"
  | "non-canonical"

/** A path-addressed finding from DDL preflight or rendering. */
export interface DdlDiagnostic {
  readonly code: DdlDiagnosticCode
  readonly severity: "error" | "warning"
  readonly message: string
  readonly operationId?: string
  readonly path: readonly (string | number)[]
  readonly kind?: MigrationOperation["kind"]
  readonly dialect?: string
  readonly requiredVersion?: string
  readonly actualVersion?: string
  readonly lock?: MigrationLockRequirement
  readonly transaction?: MigrationTransactionRequirement
}

/** One deterministic statement emitted for one plan operation. */
export interface DdlStatement {
  readonly operationId: string
  readonly position: number
  readonly kind: MigrationOperation["kind"]
  /** SQL text with dialect placeholders, if a dialect ever needs them. */
  readonly sql: string
  /** Alias for callers that use the query renderer's terminology. */
  readonly text: string
  /** DDL literals are normally in SQL; this remains explicit and ordered. */
  readonly parameters: readonly unknown[]
}

/** Policy and execution-context facts used by DDL preflight. */
export interface DdlEmissionOptions {
  /** Permit a plan whose own `ready` flag is false after reviewing diagnostics. */
  readonly allowBlocked?: boolean
  /** Alias for callers that intentionally permit all review gates. */
  readonly allowUnsafe?: boolean
  readonly allowDecisionRequired?: boolean
  readonly allowUnknown?: boolean
  readonly allowLossy?: boolean
  readonly allowUnsupported?: boolean
  readonly allowDestructive?: boolean
  readonly allowReviewRequired?: boolean
  /** Server version used for syntax checks, such as SQLite DROP COLUMN. */
  readonly serverVersion?: string | number
  /** Whether the caller will wrap statements in one transaction. */
  readonly transaction?: "managed" | "autocommit" | "none"
  /** Maximum lock the caller can acquire for this migration. */
  readonly lock?: Exclude<MigrationLockRequirement, "unknown">
}

/** Result of preflight plus deterministic statement rendering. */
export interface DdlEmission {
  readonly ok: boolean
  readonly dialect: string
  readonly statements: readonly DdlStatement[]
  readonly diagnostics: readonly DdlDiagnostic[]
  /** Statements joined with a newline for simple migration-file writers. */
  readonly sql: string
  /** Flattened parameters in statement order. */
  readonly parameters: readonly unknown[]
}

/** Descriptive alias for callers that name rendered output as a result. */
export type DdlEmissionResult = DdlEmission

/** A dialect-specific DDL emitter. */
export interface DdlEmitter {
  readonly dialect: string
  diagnose(
    plan: MigrationPlan,
    schemaDialect: SchemaDialect,
    options?: DdlEmissionOptions,
  ): readonly DdlDiagnostic[]
  emit(plan: MigrationPlan, schemaDialect: SchemaDialect, options?: DdlEmissionOptions): DdlEmission
}
