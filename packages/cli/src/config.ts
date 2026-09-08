import type {
  ArtifactConstraints,
  ArtifactProvenance,
  CustomProgramSubstitution,
  MigrationOperation,
  OperationApproval,
  RendererDescriptor,
} from "@qubu/migrate/artifact"
import { fromMigrationAdapter, type BaselineAdapter } from "@qubu/migrate/baseline"
import type { MigrationAdapter } from "@qubu/migrate/executor"
import type { Schema } from "qubu/schema"
import type { SchemaSnapshot, SnapshotJsonValue } from "qubu/snapshot"

export type ConfigSnapshotValue = SchemaSnapshot
export type ConfigSnapshot =
  | ConfigSnapshotValue
  | (() => ConfigSnapshotValue | Promise<ConfigSnapshotValue>)

export interface MigrationApprovalContext {
  readonly operation: MigrationOperation
  readonly findings: readonly string[]
  readonly requestedReason?: string
}

export interface QubuCliConfig {
  /** New-table order for generation; alignment is PostgreSQL-only. Defaults to declaration. */
  readonly columnOrder?: "declaration" | "alignment"
  /** Application schema, retained for ownership and custom snapshot conversion. */
  readonly schema?: Schema<any>
  /** Canonical target snapshot, or application-owned conversion of `schema`. */
  readonly snapshot?: ConfigSnapshot
  readonly snapshotFromSchema?: (schema: Schema<any>) => SchemaSnapshot | Promise<SchemaSnapshot>
  readonly artifacts: string
  /** Adoption may use a baseline-only adapter; execution commands require a migration adapter. */
  readonly adapter?: () =>
    | MigrationAdapter
    | BaselineAdapter
    | Promise<MigrationAdapter | BaselineAdapter>
  readonly approvals?: (
    context: MigrationApprovalContext,
  ) => OperationApproval | undefined | Promise<OperationApproval | undefined>
  readonly customPrograms?: readonly CustomProgramSubstitution[]
  readonly renderer?: RendererDescriptor
  /** Actual server version used while resolving renderer constraints. */
  readonly serverVersion?: string
  readonly constraints?: ArtifactConstraints
  readonly provenance?: ArtifactProvenance
  readonly environment?: "development" | "test" | "staging" | "production"
  readonly baselineOperator?: SnapshotJsonValue
  /** Application-owned proof used by explicit reconciliation. */
  readonly verifyReconciliation?: (input: {
    readonly attemptId: string
    readonly outcome: "applied" | "rolled_back"
    readonly snapshot: ConfigSnapshotValue
    readonly signal: AbortSignal
  }) => boolean | Promise<boolean>
}

export function defineConfig(config: QubuCliConfig): QubuCliConfig {
  return config
}

export async function resolveConfigSnapshot(config: QubuCliConfig): Promise<ConfigSnapshotValue> {
  if (config.snapshot) {
    return typeof config.snapshot === "function" ? await config.snapshot() : config.snapshot
  }

  if (config.schema && config.snapshotFromSchema) {
    return config.snapshotFromSchema(config.schema)
  }

  throw new Error("Config must define snapshot, or schema with snapshotFromSchema")
}

export async function resolveAdapter(config: QubuCliConfig): Promise<MigrationAdapter> {
  if (!config.adapter) {
    throw new Error("This command requires config.adapter")
  }

  const adapter = await config.adapter()

  if (!("openMigrationSession" in adapter)) {
    throw new Error(
      "This command requires migration execution; config.adapter supports only schema adoption",
    )
  }

  return adapter
}

/** Resolve adoption independently of the migration executor's capabilities. */
export async function resolveBaselineAdapter(config: QubuCliConfig): Promise<BaselineAdapter> {
  if (!config.adapter) {
    throw new Error("This command requires config.adapter")
  }

  const adapter = await config.adapter()

  return "openBaselineSession" in adapter ? adapter : fromMigrationAdapter(adapter)
}
