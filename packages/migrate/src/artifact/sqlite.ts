import { diffSnapshots } from "qubu/diff"
import type { SchemaSnapshot, SnapshotTable } from "qubu/snapshot"
import { sqliteSchemaDialect } from "qubu/snapshot/sqlite"

import { createMigrationPlan, type MigrationPlan } from "../plan/index.ts"
import {
  compileMigrationProgram as compileGenericMigrationProgram,
  type CompileMigrationProgramOptions,
} from "./program.ts"
import {
  migrationProgramFormat,
  migrationProgramVersion,
  type MigrationProgramCompilationResult,
  type MigrationProgramPhase,
} from "./types.ts"
import { compilationFailure as failure, deepFreeze } from "./utils.ts"

export interface CompileSqliteMigrationProgramOptions extends CompileMigrationProgramOptions {
  /** Required when SQLite must rebuild an existing table. */
  readonly beforeSnapshot?: SchemaSnapshot
  /** Required when SQLite must rebuild an existing table. */
  readonly afterSnapshot?: SchemaSnapshot
}

/** Compile a reviewed migration plan with SQLite's schema dialect and rebuild support. */
export function compileMigrationProgram(
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
  return compileGenericMigrationProgram(plan, sqliteSchemaDialect, options)
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
  const compiled = compileGenericMigrationProgram(planned.plan, sqliteSchemaDialect)
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
