import { diffSnapshots } from "qubu/diff"
import type { SchemaDialect } from "qubu/schema"
import type { SnapshotJsonValue } from "qubu/snapshot"
import type { SchemaSnapshot, SnapshotTable } from "qubu/snapshot"
import { mysqlSchemaDialect } from "qubu/snapshot/mysql"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { sqliteSchemaDialect } from "qubu/snapshot/sqlite"

import { ddlEmitterForDialect } from "../ddl/index.ts"
import { assertMigrationPlan, type MigrationOperation, type MigrationPlan } from "../plan/index.ts"
import { createMigrationPlan } from "../plan/index.ts"
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

export interface CompileMigrationProgramOptions {
  readonly approvals?: readonly OperationApproval[]
  readonly customPrograms?: readonly CustomProgramSubstitution[]
  readonly serverVersion?: string | number
}

export interface CompileSqliteMigrationProgramOptions extends CompileMigrationProgramOptions {
  /** Required when SQLite must rebuild an existing table. */
  readonly beforeSnapshot?: SchemaSnapshot
  /** Required when SQLite must rebuild an existing table. */
  readonly afterSnapshot?: SchemaSnapshot
}

const lockRank = { none: 0, shared: 1, exclusive: 2 } as const

/**
 * Lower a reviewed plan into its authoritative, versioned execution program. Policy is
 * operation-scoped: broad unsafe renderer flags are deliberately unavailable here.
 */
export function compileMigrationProgram(
  input: MigrationPlan,
  dialect: SchemaDialect,
  options: CompileMigrationProgramOptions = {},
): MigrationProgramCompilationResult {
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

  const operations = plan.operations.filter(
    (operation) =>
      operation.status !== "skipped" &&
      !(
        operation.type === "add" &&
        (operation.kind === "column" ||
          (dialect.name === "sqlite" && operation.kind === "constraint")) &&
        plan.operations.some(
          (candidate) =>
            candidate.type === "add" &&
            candidate.kind === "table" &&
            candidate.logicalId === operation.origin?.after?.parent?.id,
        )
      ),
  )
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
  })
  const phases: MigrationProgramPhase[] = []
  const provenance: CustomProgramProvenance[] = []

  for (const operation of operations) {
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
      operationRenderDiagnostics.some((finding) =>
        ["unknown", "unsupported"].includes(finding.code),
      )
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
    } else {
      if (operation.transaction === "unknown" || operation.lock === "unknown") continue
      transaction = operation.transaction
      lock = operation.lock
      const sql = emitter.renderOperation(operation, plan.operations, dialect)
      if (sql === undefined || sql.trim().length === 0) {
        // Child facts may already be represented by a parent CREATE/DROP statement.
        continue
      }
      statements = [{ sql, parameters: [] }]
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
      preconditions: custom?.preconditions ?? conditionsFor(operation),
      postconditions: custom?.postconditions ?? [],
    })
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: Object.freeze(diagnostics) }
  }

  const program: MigrationProgram = {
    format: migrationProgramFormat,
    version: migrationProgramVersion,
    phases,
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

export function compilePostgresMigrationProgram(
  plan: MigrationPlan,
  options?: CompileMigrationProgramOptions,
): MigrationProgramCompilationResult {
  return compileMigrationProgram(plan, postgresSchemaDialect, options)
}

export function compileSqliteMigrationProgram(
  plan: MigrationPlan,
  options: CompileSqliteMigrationProgramOptions = {},
): MigrationProgramCompilationResult {
  const rebuildTables = sqliteRebuildTableIds(plan)
  if (rebuildTables.length > 0) {
    if (!options.beforeSnapshot || !options.afterSnapshot)
      return failure(
        "unsupported",
        "SQLite table rebuild compilation requires exact beforeSnapshot and afterSnapshot values",
        ["afterSnapshot"],
      )
    return compileSqliteRebuildProgram(plan, rebuildTables, options)
  }
  return compileMigrationProgram(plan, sqliteSchemaDialect, options)
}

export function compileMysqlMigrationProgram(
  plan: MigrationPlan,
  options?: CompileMigrationProgramOptions,
): MigrationProgramCompilationResult {
  return compileMigrationProgram(plan, mysqlSchemaDialect, options)
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

function conditionsFor(operation: MigrationOperation): readonly ProgramCondition[] {
  return operation.preconditions.map((condition, index) => ({
    id: `${operation.id}-precondition-${index}`,
    type:
      condition.type === "object-present" || condition.type === "object-absent"
        ? condition.type
        : "statement",
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

function failure(
  code: ProgramCompilationDiagnostic["code"],
  message: string,
  path: readonly (string | number)[],
): MigrationProgramCompilationResult {
  return { ok: false, diagnostics: Object.freeze([issue(code, message, path)]) }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function sqliteRebuildTableIds(plan: MigrationPlan): readonly string[] {
  const addedTables = new Set(
    plan.operations
      .filter((operation) => operation.type === "add" && operation.kind === "table")
      .map((operation) => operation.logicalId),
  )
  return [
    ...new Set(
      plan.operations.flatMap((operation) => {
        const parent = operation.origin?.after?.parent ?? operation.origin?.before?.parent
        if (
          !parent ||
          addedTables.has(parent.id) ||
          !["column", "constraint"].includes(operation.kind) ||
          (operation.type === "add" && operation.kind === "column")
        )
          return []
        return [parent.id]
      }),
    ),
  ].sort()
}

function compileSqliteRebuildProgram(
  plan: MigrationPlan,
  tableIds: readonly string[],
  options: CompileSqliteMigrationProgramOptions,
): MigrationProgramCompilationResult {
  const before = options.beforeSnapshot!
  const after = options.afterSnapshot!
  const approvals = new Map(
    (options.approvals ?? []).map((approval) => [approval.operationId, approval]),
  )
  for (const operation of plan.operations) {
    const parent = operation.origin?.after?.parent ?? operation.origin?.before?.parent
    if (!parent || !tableIds.includes(parent.id) || operation.safety === "safe") continue
    const approval = approvals.get(operation.id)
    const findings = plan.diagnostics
      .filter((finding) => finding.operationId === operation.id)
      .map((finding) => finding.code)
      .sort()
    if (
      approval?.decision !== "approve" ||
      approval.safety !== operation.safety ||
      approval.reason.trim().length === 0 ||
      approval.findings.join("\0") !== findings.join("\0")
    )
      return failure(
        "approval-required",
        `SQLite rebuild operation ${operation.id} requires exact approval`,
        ["approvals"],
      )
  }

  const phases: MigrationProgramPhase[] = []
  for (const tableId of tableIds) {
    const source = before.tables.find((table) => table.id === tableId)
    const target = after.tables.find((table) => table.id === tableId)
    if (!source || !target)
      return failure("unsupported", `SQLite rebuild table ${tableId} is missing from a snapshot`, [
        "afterSnapshot",
        "tables",
      ])
    const rendered = sqliteCreateStatements(after, target)
    if (!rendered.ok) return rendered
    const temporaryName = `__qubu_rebuild_${target.physicalName}`
    const targetQualified = qualifySqlite(after.namespace, target.physicalName)
    const temporaryQualified = qualifySqlite(after.namespace, temporaryName)
    const common = target.columns.flatMap((column) => {
      const old = source.columns.find((candidate) => candidate.id === column.id)
      return old ? [{ old: old.physicalName, next: column.physicalName }] : []
    })
    const operationId =
      plan.operations.find((operation) => {
        const parent = operation.origin?.after?.parent ?? operation.origin?.before?.parent
        return parent?.id === tableId
      })?.id ?? `sqlite-rebuild-${tableId}`
    const sql = [
      rendered.create.replace(targetQualified, temporaryQualified),
      ...(common.length === 0
        ? []
        : [
            `INSERT INTO ${temporaryQualified} (${common.map((item) => quoteSqlite(item.next)).join(", ")}) SELECT ${common.map((item) => quoteSqlite(item.old)).join(", ")} FROM ${targetQualified}`,
          ]),
      `DROP TABLE ${targetQualified}`,
      `ALTER TABLE ${temporaryQualified} RENAME TO ${quoteSqlite(target.physicalName)}`,
      ...rendered.indexes,
    ]
    const phasePosition = phases.length
    phases.push({
      id: `sqlite-rebuild-${tableId}`,
      position: phasePosition,
      transaction: "required",
      lock: "exclusive",
      dependsOn: phasePosition === 0 ? [] : [phases[phasePosition - 1]!.id],
      statements: sql.map((statement, position) => ({
        id: `sqlite-rebuild-${tableId}-${position}`,
        position,
        operationId,
        sql: statement,
        parameters: [],
        dependsOn: position === 0 ? [] : [`sqlite-rebuild-${tableId}-${position - 1}`],
      })),
      preconditions: [
        {
          id: `${tableId}-source-present`,
          type: "object-present",
          value: { kind: "table", physicalName: source.physicalName },
        },
      ],
      postconditions: [
        {
          id: `${tableId}-target-present`,
          type: "object-present",
          value: { kind: "table", physicalName: target.physicalName },
        },
      ],
    })
  }
  return {
    ok: true,
    program: deepFreeze({
      format: migrationProgramFormat,
      version: migrationProgramVersion,
      phases,
    }),
    customPrograms: [],
  }
}

function sqliteCreateStatements(
  snapshot: SchemaSnapshot,
  table: SnapshotTable,
):
  | { readonly ok: true; readonly create: string; readonly indexes: readonly string[] }
  | Extract<MigrationProgramCompilationResult, { readonly ok: false }> {
  const empty: SchemaSnapshot = { ...snapshot, tables: [] }
  const planned = createMigrationPlan(diffSnapshots(empty, snapshot))
  if (!planned.ok)
    return failure("unsupported", `Could not plan SQLite rebuild table ${table.id}`, [
      "afterSnapshot",
      "tables",
    ]) as Extract<MigrationProgramCompilationResult, { readonly ok: false }>
  const compiled = compileMigrationProgram(planned.plan, sqliteSchemaDialect)
  if (!compiled.ok) return compiled
  const statements = compiled.program.phases.flatMap((phase) =>
    phase.statements.map((item) => item.sql),
  )
  const qualifiedTable = qualifySqlite(snapshot.namespace, table.physicalName)
  const create = statements.find((statement) =>
    statement.startsWith(`CREATE TABLE ${qualifiedTable}`),
  )
  if (!create)
    return failure("render-failed", `Could not render SQLite rebuild table ${table.id}`, [
      "afterSnapshot",
      "tables",
    ]) as Extract<MigrationProgramCompilationResult, { readonly ok: false }>
  return {
    ok: true,
    create,
    indexes: statements.filter(
      (statement) =>
        /^CREATE (?:UNIQUE )?INDEX\b/u.test(statement) &&
        statement.includes(` ON ${qualifiedTable} `),
    ),
  }
}

function quoteSqlite(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function qualifySqlite(namespace: string | undefined, value: string): string {
  return namespace ? `${quoteSqlite(namespace)}.${quoteSqlite(value)}` : quoteSqlite(value)
}
