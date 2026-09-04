import { compileMigrationProgram } from "@qubu/migrate/artifact"
import type {
  CompileMigrationProgramOptions,
  CustomProgramSubstitution,
  MigrationProgramCompilationResult,
  OperationApproval,
} from "@qubu/migrate/artifact"
import type { MigrationPlan } from "@qubu/migrate/plan"
import type { SnapshotDiffObject } from "qubu/diff"
import { sqliteSchemaDialect } from "qubu/snapshot/sqlite"

import { isObject } from "./snapshot.ts"

export interface Fts5MigrationInputs {
  readonly approvals: readonly OperationApproval[]
  readonly customPrograms: readonly CustomProgramSubstitution[]
}

/**
 * Supply exact custom programs for FTS5 operations, whose virtual-table and shadow-table lifecycle
 * is intentionally outside Qubu's ordinary DDL emitter.
 */
export function programs(plan: MigrationPlan): Fts5MigrationInputs {
  const operations = plan.operations.filter((operation) => operation.status !== "skipped")
  const customPrograms: CustomProgramSubstitution[] = []
  const approvals: OperationApproval[] = []

  for (const operation of operations) {
    const before = ftsObject(operation.origin?.before)
    const after = ftsObject(operation.origin?.after)

    if (before === undefined && after === undefined) {
      continue
    }

    // Inline/contentless indexes cannot be reconstructed from an external source after DROP.
    // Leave these replacements to an explicit caller-supplied data-preserving custom program.
    if (
      operation.type !== "add" &&
      operation.type !== "remove" &&
      (!before?.rebuildable || !after?.rebuildable)
    ) {
      continue
    }

    const statements =
      operation.type === "remove"
        ? before?.statements.uninstall
        : operation.type === "add"
          ? after?.statements.install
          : before !== undefined && after !== undefined
            ? [...before.statements.uninstall, ...after.statements.install]
            : undefined

    if (statements === undefined || statements.length === 0) {
      continue
    }

    const name = after?.name ?? before?.name ?? operation.physicalName ?? operation.id
    const reason = `SQLite FTS5 operation for "${name}" requires addon-owned virtual-table and synchronization SQL`

    customPrograms.push({
      operationId: operation.id,
      source: "@qubu/sqlite-fts5",
      reason,
      transaction: "required",
      lock: "exclusive",
      statements: statements.map((sql) => ({
        sql,
        parameters: [],
      })),
    })
    approvals.push({
      operationId: operation.id,
      decision: "custom-program",
      safety: operation.safety,
      findings: plan.diagnostics
        .filter((diagnostic) => diagnostic.operationId === operation.id)
        .map((diagnostic) => diagnostic.code)
        .sort(),
      reason,
    })
  }

  return {
    approvals: Object.freeze(approvals),
    customPrograms: Object.freeze(customPrograms),
  }
}

/** Compile a migration plan with generated FTS5 custom programs and exact approvals. */
export function compile(
  plan: MigrationPlan,
  options: CompileMigrationProgramOptions = {},
): MigrationProgramCompilationResult {
  const generated = programs(plan)
  const approvalIds = new Set((options.approvals ?? []).map((approval) => approval.operationId))
  const customIds = new Set(
    (options.customPrograms ?? []).map((customProgram) => customProgram.operationId),
  )

  return compileMigrationProgram(plan, sqliteSchemaDialect, {
    ...options,
    approvals: [
      ...(options.approvals ?? []),
      ...generated.approvals.filter((approval) => !approvalIds.has(approval.operationId)),
    ],
    customPrograms: [
      ...(options.customPrograms ?? []),
      ...generated.customPrograms.filter(
        (customProgram) => !customIds.has(customProgram.operationId),
      ),
    ],
  })
}

/** Namespace-first migration helpers for consumers that opt into `@qubu/migrate`. */
export const fts5Migration = Object.freeze({
  programs,
  compile,
})

const fts5Data = (
  object: SnapshotDiffObject | undefined,
):
  | {
      readonly name: string
      readonly rebuildable: boolean
      readonly statements: {
        readonly install: readonly string[]
        readonly uninstall: readonly string[]
      }
    }
  | undefined => {
  if (object === undefined || !isObject(object.value)) {
    return undefined
  }

  const data = object.value.data

  if (!isSnapshotRecord(data)) {
    return undefined
  }

  const statements = data.statements

  if (!isSnapshotRecord(statements)) {
    return undefined
  }

  const install = statements.install
  const uninstall = statements.uninstall

  if (
    !Array.isArray(install) ||
    !Array.isArray(uninstall) ||
    !install.every((statement): statement is string => typeof statement === "string") ||
    !uninstall.every((statement): statement is string => typeof statement === "string")
  ) {
    return undefined
  }

  return {
    name: typeof data.name === "string" ? data.name : (object.physicalName ?? object.id),
    rebuildable: isSnapshotRecord(data.content),
    statements: {
      install,
      uninstall,
    },
  }
}

function ftsObject(object: SnapshotDiffObject | undefined) {
  return fts5Data(object)
}

function isSnapshotRecord(
  value: import("qubu/snapshot").SnapshotJsonValue,
): value is { readonly [key: string]: import("qubu/snapshot").SnapshotJsonValue } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !Object.hasOwn(value, "$number") &&
    !Object.hasOwn(value, "$bigint")
  )
}
