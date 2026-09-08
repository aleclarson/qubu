import type { SchemaDialect } from "qubu/schema"
import type { SchemaSnapshot, SnapshotJsonValue } from "qubu/snapshot"

import { columnOrderError, type ColumnOrder } from "../ddl/column-order.ts"
import { ddlEmitterForDialect } from "../ddl/index.ts"
import { assertMigrationPlan, type MigrationOperation, type MigrationPlan } from "../plan/index.ts"
import { canonicalText } from "./canonical.ts"
import { validateMigrationProgram } from "./codec.ts"
import {
  migrationProgramFormat,
  migrationProgramVersion,
  type CustomProgramProvenance,
  type CustomProgramSubstitution,
  type MigrationProgram,
  type MigrationProgramCompilationResult,
  type MigrationProgramPhase,
  type MigrationProgramStatement,
  type OperationApproval,
  type ProgramCompilationDiagnostic,
  type ProgramCondition,
  type ProgramLockRequirement,
  type ProgramTransactionRequirement,
  type TaggedParameterValue,
} from "./types.ts"
import { compilationFailure as failure, deepFreeze } from "./utils.ts"

export interface CompileMigrationProgramOptions {
  /** Authoritative target metadata for references to unchanged tables and columns. */
  readonly afterSnapshot?: SchemaSnapshot
  /** New-table order; defaults to declaration. Alignment is PostgreSQL-only. */
  readonly columnOrder?: ColumnOrder
  readonly approvals?: readonly OperationApproval[]
  readonly customPrograms?: readonly CustomProgramSubstitution[]
  readonly serverVersion?: string | number
}

/** Compiler-owned lowering of operations represented by one atomic table replacement. */
export interface OperationGroup {
  readonly operationIds: readonly string[]
  readonly statements?: readonly string[]
  readonly transaction?: ProgramTransactionRequirement
  readonly lock?: ProgramLockRequirement
  readonly postconditions?: readonly ProgramCondition[]
}

type PrepareGroups = (
  plan: MigrationPlan,
) =>
  | { readonly ok: true; readonly groups: readonly OperationGroup[] }
  | Extract<MigrationProgramCompilationResult, { readonly ok: false }>

const lockRank = { none: 0, shared: 1, exclusive: 2 } as const

/**
 * Lower a reviewed plan into its authoritative, versioned execution program. Policy is
 * operation-scoped: broad unsafe renderer flags are deliberately unavailable here.
 */
export function compileMigrationProgram(
  input: MigrationPlan,
  dialect: SchemaDialect,
  options: CompileMigrationProgramOptions = {},
  prepareGroups?: PrepareGroups,
): MigrationProgramCompilationResult {
  const orderingError = columnOrderError(options.columnOrder, dialect.name)

  if (orderingError) {
    return failure("unsupported", orderingError, ["columnOrder"])
  }

  const diagnostics: ProgramCompilationDiagnostic[] = []
  let plan: MigrationPlan

  try {
    plan = assertMigrationPlan(input)
  } catch {
    return failure("invalid-plan", "Migration plan must be valid and fully decided", [])
  }

  if (plan.dialect.name !== dialect.name || plan.dialect.version !== dialect.schema.version) {
    return failure(
      "dialect-mismatch",
      `Migration plan dialect ${plan.dialect.name}@${plan.dialect.version} does not match ${dialect.name}@${dialect.schema.version}`,
      ["dialect"],
    )
  }

  const prepared = prepareGroups?.(plan)
  if (prepared && !prepared.ok) return prepared
  const operations = plan.operations.filter((operation) => operation.status !== "skipped")
  const groups: OperationGroup[] = [...(prepared?.groups ?? [])]
  for (const parent of operations) {
    if (
      !["table", "view", "materialized-view"].includes(parent.kind) ||
      !["add", "remove"].includes(parent.type)
    )
      continue
    const children = plan.operations.filter(
      (operation) =>
        operation.origin?.[parent.type === "add" ? "after" : "before"]?.parent?.id ===
          parent.logicalId &&
        operation.namespace === parent.namespace &&
        operation.type === parent.type &&
        (parent.type === "remove" ||
          operation.kind === "column" ||
          (dialect.name === "sqlite" && operation.kind === "constraint")),
    )
    if (children.some((child) => child.status === "skipped"))
      return failure("unsupported", "A containing operation cannot apply skipped child changes", [
        "operations",
      ])
    if (children.length)
      groups.push({ operationIds: [parent.id, ...children.map((child) => child.id)] })
  }
  const groupFor = new Map<string, OperationGroup>()
  for (const group of groups)
    for (const id of group.operationIds) {
      if (groupFor.has(id))
        return failure("unsupported", "Overlapping containing operations", ["operations"])
      groupFor.set(id, group)
    }
  const operationIds = new Set(operations.map((operation) => operation.id))
  const approvals = indexExact(options.approvals ?? [], "approvals", operationIds, diagnostics)
  const customPrograms = indexExact(
    options.customPrograms ?? [],
    "customPrograms",
    operationIds,
    diagnostics,
  )
  const emitter = ddlEmitterForDialect(dialect)
  const renderDiagnostics = emitter.diagnose(plan, dialect, {
    serverVersion: options.serverVersion,
    columnOrder: options.columnOrder,
    afterSnapshot: options.afterSnapshot,
  })
  const metadataError = renderDiagnostics.find((finding) => finding.path[0] === "afterSnapshot")
  if (metadataError) return failure("invalid-plan", metadataError.message, metadataError.path)
  const phases: MigrationProgramPhase[] = []
  const provenance: CustomProgramProvenance[] = []

  for (const operation of operations) {
    const group = groupFor.get(operation.id)
    const lowered = group?.statements !== undefined
    const approval = approvals.get(operation.id)
    const custom = customPrograms.get(operation.id) as CustomProgramSubstitution | undefined
    const findings = plan.diagnostics
      .filter((finding) => finding.operationId === operation.id)
      .map((finding) => finding.code)
      .sort()
    const operationRenderDiagnostics = renderDiagnostics.filter(
      (finding) => finding.operationId === operation.id,
    )
    const needsCustom =
      operation.type === "custom-sql" ||
      operation.safety === "unknown" ||
      operation.safety === "unsupported" ||
      operation.transaction === "unknown" ||
      operation.lock === "unknown" ||
      (!group &&
        operationRenderDiagnostics.some((finding) =>
          ["unknown", "unsupported"].includes(finding.code),
        ))
    const needsApproval = operation.safety !== "safe" || operation.type === "custom-sql"

    validateApproval(operation, approval, findings, needsCustom, needsApproval, diagnostics)

    if (needsCustom && custom === undefined) {
      diagnostics.push(
        issue(
          "custom-program-required",
          `Operation ${operation.id} requires an exact custom program and provenance`,
          ["customPrograms"],
          operation.id,
        ),
      )
      continue
    }

    if (!needsCustom && custom !== undefined) {
      diagnostics.push(
        issue(
          "invalid-custom-program",
          `Operation ${operation.id} does not require a custom-program substitution`,
          ["customPrograms"],
          operation.id,
        ),
      )
      continue
    }

    const hardFinding = operationRenderDiagnostics.find((finding) =>
      ["dialect-mismatch", "server-version", "malformed-operation", "capability"].includes(
        finding.code,
      ),
    )
    if (hardFinding !== undefined && custom === undefined) {
      diagnostics.push(
        issue(
          hardFinding.code === "dialect-mismatch" ? "dialect-mismatch" : "unsupported",
          hardFinding.message,
          hardFinding.path,
          operation.id,
        ),
      )
      continue
    }

    if (group && (needsCustom || custom)) {
      diagnostics.push(
        issue(
          "unsupported",
          "A containing table operation cannot absorb a custom program",
          ["operations"],
          operation.id,
        ),
      )
      continue
    }
    if (group && operation.transaction === "forbidden" && group.transaction === "required") {
      diagnostics.push(
        issue(
          "transaction-conflict",
          "Table rebuild requires a transaction",
          ["operations"],
          operation.id,
        ),
      )
      continue
    }
    if (group && group.operationIds[0] !== operation.id) continue

    let statements: readonly {
      readonly sql: string
      readonly parameters: readonly TaggedParameterValue[]
    }[]
    let transaction: ProgramTransactionRequirement
    let lock: ProgramLockRequirement

    if (custom !== undefined) {
      if (custom.source.trim().length === 0 || custom.reason.trim().length === 0) {
        diagnostics.push(
          issue(
            "invalid-custom-program",
            `Custom program ${operation.id} requires non-empty source and reason provenance`,
            ["customPrograms"],
            operation.id,
          ),
        )
        continue
      }
      if (custom.statements.length === 0 || custom.statements.some((item) => !item.sql.trim())) {
        diagnostics.push(
          issue(
            "invalid-custom-program",
            `Custom program ${operation.id} must contain non-empty SQL statements`,
            ["customPrograms"],
            operation.id,
          ),
        )
        continue
      }

      const resolved = resolveRequirements(operation, custom, diagnostics)
      if (resolved === undefined) continue
      transaction = resolved.transaction
      lock = resolved.lock
      statements = custom.statements.map((item) => ({
        sql: item.sql.trim(),
        parameters: item.parameters ?? [],
      }))
      provenance.push({
        operationId: custom.operationId,
        source: custom.source,
        reason: custom.reason,
        ...(custom.revision === undefined ? {} : { revision: custom.revision }),
      })
    } else if (lowered) {
      transaction = group.transaction!
      lock = group.lock!
      statements = group.statements!.map((sql) => ({ sql, parameters: [] }))
    } else {
      if (operation.transaction === "unknown" || operation.lock === "unknown") continue
      transaction = operation.transaction
      lock = operation.lock
      let sql: string | undefined
      try {
        sql = emitter.renderOperation(operation, operations, dialect, {
          columnOrder: options.columnOrder,
          afterSnapshot: options.afterSnapshot,
        })
      } catch (error) {
        diagnostics.push(issue("render-failed", String(error), ["operations"], operation.id))
        continue
      }

      if (sql === undefined || sql.trim().length === 0) {
        diagnostics.push(
          issue(
            "render-failed",
            "Active operation produced no SQL or containing operation",
            ["operations"],
            operation.id,
          ),
        )
        continue
      }
      statements = [{ sql, parameters: [] }]
    }

    if (group) {
      const members = operations.filter((member) => group.operationIds.includes(member.id))
      const requirements = new Set([transaction, ...members.map((member) => member.transaction)])
      if (requirements.has("required") && requirements.has("forbidden")) {
        diagnostics.push(
          issue(
            "transaction-conflict",
            "Containing operations have incompatible transaction requirements",
            ["operations"],
            operation.id,
          ),
        )
        continue
      }
      transaction = requirements.has("required")
        ? "required"
        : requirements.has("forbidden")
          ? "forbidden"
          : "optional"
      for (const member of members)
        if (member.lock !== "unknown" && lockRank[member.lock] > lockRank[lock]) lock = member.lock
    }

    const phasePosition = phases.length
    const phaseId = `phase-${phasePosition}`
    const compiledStatements: MigrationProgramStatement[] = statements.map((statement, index) => ({
      id: `statement-${phasePosition}-${index}`,
      position: index,
      operationId: operation.id,
      sql: statement.sql,
      parameters: Object.freeze([...statement.parameters]),
      dependsOn: index === 0 ? [] : [`statement-${phasePosition}-${index - 1}`],
    }))
    phases.push({
      id: phaseId,
      position: phasePosition,
      transaction,
      lock,
      dependsOn: phasePosition === 0 ? [] : [`phase-${phasePosition - 1}`],
      statements: compiledStatements,
      ...(group ? { absorbedOperationIds: group.operationIds.slice(1) } : {}),
      preconditions:
        custom?.preconditions ??
        (group ? groupConditions(group, operations) : conditionsFor(operation)),
      postconditions: custom?.postconditions ?? group?.postconditions ?? [],
    })
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: Object.freeze(diagnostics) }
  }

  const phaseFor = new Map(
    phases.flatMap((phase) =>
      [
        ...new Set([
          ...phase.statements.map((statement) => statement.operationId),
          ...(phase.absorbedOperationIds ?? []),
        ]),
      ].map((id) => [id, phase] as const),
    ),
  )
  const ordered: MigrationProgramPhase[] = []
  const pending = new Set(phases)
  while (pending.size) {
    const next = [...pending].find((phase) =>
      operations
        .filter((operation) => phaseFor.get(operation.id) === phase)
        .every((operation) =>
          operation.dependsOn.every((id) => {
            const dependency = phaseFor.get(id)
            return dependency === phase || (dependency !== undefined && !pending.has(dependency))
          }),
        ),
    )
    if (!next)
      return failure("unsupported", "Containing operations cannot preserve plan dependency order", [
        "dependencies",
      ])
    pending.delete(next)
    const position = ordered.length
    ordered.push({
      ...next,
      id: `phase-${position}`,
      position,
      dependsOn: position ? [`phase-${position - 1}`] : [],
      statements: next.statements.map((statement, index) => ({
        ...statement,
        id: `statement-${position}-${index}`,
        position: index,
        dependsOn: index ? [`statement-${position}-${index - 1}`] : [],
      })),
    })
  }

  const program: MigrationProgram = {
    format: migrationProgramFormat,
    version: migrationProgramVersion,
    ...(options.columnOrder === undefined ? {} : { columnOrder: options.columnOrder }),
    phases: ordered,
  }
  const programDiagnostics = validateMigrationProgram(program, plan)
  if (programDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: Object.freeze(
        programDiagnostics.map((diagnostic) =>
          issue("invalid-custom-program", diagnostic.message, diagnostic.path),
        ),
      ),
    }
  }
  return {
    ok: true,
    program: deepFreeze(program),
    customPrograms: Object.freeze(
      provenance.slice().sort((left, right) => left.operationId.localeCompare(right.operationId)),
    ),
  }
}

function validateApproval(
  operation: MigrationOperation,
  approval: OperationApproval | undefined,
  findings: readonly string[],
  needsCustom: boolean,
  required: boolean,
  diagnostics: ProgramCompilationDiagnostic[],
): void {
  if (!required && approval === undefined) return
  if (approval === undefined) {
    diagnostics.push(
      issue(
        "approval-required",
        `Operation ${operation.id} requires exact approval`,
        ["approvals"],
        operation.id,
      ),
    )
    return
  }
  const expectedDecision = needsCustom ? "custom-program" : "approve"
  if (
    approval.decision !== expectedDecision ||
    approval.safety !== operation.safety ||
    approval.reason.trim().length === 0 ||
    approval.findings.length !== findings.length ||
    approval.findings.some((finding, index) => finding !== findings[index])
  ) {
    diagnostics.push(
      issue(
        "invalid-approval",
        `Approval for ${operation.id} must exactly match its decision, safety, findings, and reason`,
        ["approvals"],
        operation.id,
      ),
    )
  }
}

function resolveRequirements(
  operation: MigrationOperation,
  custom: CustomProgramSubstitution,
  diagnostics: ProgramCompilationDiagnostic[],
): { transaction: ProgramTransactionRequirement; lock: ProgramLockRequirement } | undefined {
  if (
    (operation.transaction === "required" && custom.transaction === "forbidden") ||
    (operation.transaction === "forbidden" && custom.transaction === "required")
  ) {
    diagnostics.push(
      issue(
        "transaction-conflict",
        `Custom program ${operation.id} conflicts with the operation transaction requirement`,
        ["customPrograms"],
        operation.id,
      ),
    )
    return undefined
  }
  const transaction =
    operation.transaction === "unknown" || operation.transaction === "optional"
      ? custom.transaction
      : operation.transaction
  const lock =
    operation.lock === "unknown"
      ? custom.lock
      : lockRank[operation.lock] >= lockRank[custom.lock]
        ? operation.lock
        : custom.lock
  return { transaction, lock }
}

function groupConditions(
  group: OperationGroup,
  operations: readonly MigrationOperation[],
): readonly ProgramCondition[] {
  const parent = operations.find((operation) => operation.id === group.operationIds[0])!
  const parentAbsent =
    parent.kind === "table" &&
    parent.type === "add" &&
    parent.preconditions.some(
      (condition) =>
        condition.type === "object-absent" &&
        condition.kind === "table" &&
        condition.logicalId === parent.logicalId,
    )
  const conditions = group.operationIds.flatMap((id) => {
    const operation = operations.find((item) => item.id === id)!
    return conditionsFor(operation).filter(
      (condition) =>
        !(
          parentAbsent &&
          operation !== parent &&
          condition.type === "object-absent" &&
          typeof condition.value === "object" &&
          condition.value !== null &&
          !Array.isArray(condition.value) &&
          "logicalId" in condition.value &&
          condition.value.logicalId === operation.logicalId &&
          operation.origin?.after?.parent?.id === parent.logicalId
        ),
    )
  })
  return [
    ...new Map(conditions.map((condition) => [canonicalText(condition.value), condition])).values(),
  ]
}

function conditionsFor(operation: MigrationOperation): readonly ProgramCondition[] {
  return operation.preconditions.map((condition, index) => ({
    id: `condition-${operation.position}-pre-${index}`,
    type: condition.type,
    value: condition as unknown as SnapshotJsonValue,
  }))
}

function indexExact<T extends { readonly operationId: string }>(
  values: readonly T[],
  path: "approvals" | "customPrograms",
  operationIds: ReadonlySet<string>,
  diagnostics: ProgramCompilationDiagnostic[],
): Map<string, T> {
  const result = new Map<string, T>()
  values.forEach((value, index) => {
    if (!operationIds.has(value.operationId) || result.has(value.operationId)) {
      diagnostics.push(
        issue(
          path === "approvals" ? "invalid-approval" : "invalid-custom-program",
          `${path} must target each non-skipped operation at most once`,
          [path, index, "operationId"],
          value.operationId,
        ),
      )
    } else {
      result.set(value.operationId, value)
    }
  })
  return result
}

function issue(
  code: ProgramCompilationDiagnostic["code"],
  message: string,
  path: readonly (string | number)[],
  operationId?: string,
): ProgramCompilationDiagnostic {
  return {
    code,
    message,
    path,
    ...(operationId === undefined ? {} : { operationId }),
  }
}
