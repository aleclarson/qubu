import { diffSnapshots } from "qubu/diff"
import {
  assertSchemaSnapshot,
  fingerprintSchemaSnapshot,
  type SchemaSnapshot,
  type SnapshotTable,
} from "qubu/snapshot"
import { sqliteSchemaDialect } from "qubu/snapshot/sqlite"

import { createMigrationPlan, type MigrationPlan } from "../plan/index.ts"
import {
  compileMigrationProgram as compileGenericMigrationProgram,
  type CompileMigrationProgramOptions,
} from "./program.ts"
import type { OperationGroup } from "./program.ts"
import type { MigrationProgramCompilationResult } from "./types.ts"
import { compilationFailure as failure } from "./utils.ts"

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
  return compileGenericMigrationProgram(plan, sqliteSchemaDialect, options, (validated) =>
    prepareRebuilds(validated, options),
  )
}

function prepareRebuilds(
  plan: MigrationPlan,
  options: CompileSqliteMigrationProgramOptions,
):
  | { readonly ok: true; readonly groups: readonly OperationGroup[] }
  | Extract<MigrationProgramCompilationResult, { readonly ok: false }> {
  const active = plan.operations.filter((operation) => operation.status !== "skipped")
  const added = new Set(
    active
      .filter((operation) => operation.type === "add" && operation.kind === "table")
      .map((operation) => operation.logicalId),
  )
  const removed = new Set(
    active
      .filter((operation) => operation.type === "remove" && operation.kind === "table")
      .map((operation) => operation.logicalId),
  )
  const tableIds = [
    ...new Set(
      active.flatMap((operation) => {
        const parent = operation.origin?.after?.parent ?? operation.origin?.before?.parent
        return parent &&
          !added.has(parent.id) &&
          !removed.has(parent.id) &&
          ["column", "constraint"].includes(operation.kind) &&
          !(operation.type === "add" && operation.kind === "column")
          ? [parent.id]
          : []
      }),
    ),
  ]
  if (!tableIds.length) return { ok: true, groups: [] }
  const before = options.beforeSnapshot
  const after = options.afterSnapshot
  if (!before || !after)
    return failure(
      "unsupported",
      "SQLite table rebuild compilation requires exact beforeSnapshot and afterSnapshot values",
      ["afterSnapshot"],
    )
  try {
    assertSchemaSnapshot(before)
    assertSchemaSnapshot(after)
    if (
      fingerprintSchemaSnapshot(before) !== plan.beforeFingerprint ||
      fingerprintSchemaSnapshot(after) !== plan.afterFingerprint
    )
      return failure(
        "unsupported",
        "SQLite rebuild snapshots must match the reviewed plan fingerprints",
        ["afterSnapshot"],
      )
  } catch {
    return failure("unsupported", "SQLite rebuild snapshots must be valid schema snapshots", [
      "afterSnapshot",
    ])
  }
  const groups: OperationGroup[] = []
  for (const tableId of tableIds) {
    const source = before.tables.find((table) => table.id === tableId)
    const target = after.tables.find((table) => table.id === tableId)
    if (!source || !target)
      return failure("unsupported", `SQLite rebuild table ${tableId} is missing from a snapshot`, [
        "afterSnapshot",
        "tables",
      ])
    const members = plan.operations.filter((operation) => {
      const parent = operation.origin?.after?.parent ?? operation.origin?.before?.parent
      return (
        (parent?.id === tableId && ["column", "constraint", "index"].includes(operation.kind)) ||
        (operation.kind === "table" && operation.logicalId === tableId)
      )
    })
    if (members.some((operation) => operation.status === "skipped"))
      return failure(
        "unsupported",
        "A SQLite rebuild cannot use a target containing skipped table changes",
        ["afterSnapshot", "tables"],
      )
    if (
      source.physicalName !== target.physicalName ||
      before.namespace.name !== after.namespace.name
    )
      return failure(
        "unsupported",
        "SQLite rebuild combined with a table or namespace rename requires an explicit program",
        ["afterSnapshot", "tables"],
      )
    if ([...before.triggers, ...after.triggers].some((trigger) => trigger.table.id === tableId))
      return failure(
        "unsupported",
        "SQLite rebuilds of tables with triggers require an explicit program",
        ["afterSnapshot", "triggers"],
      )
    const rendered = createStatements(after, target, options)
    if (!rendered.ok) return rendered
    const temporaryName = `__qubu_rebuild_${target.physicalName}`
    if (
      before.tables.some((table) => table.physicalName === temporaryName) ||
      after.tables.some((table) => table.physicalName === temporaryName)
    )
      return failure("unsupported", "SQLite rebuild temporary table name is already in use", [
        "afterSnapshot",
        "tables",
      ])
    const targetQualified = qualify(after.namespace.name, target.physicalName)
    const temporaryQualified = qualify(after.namespace.name, temporaryName)
    const common = target.columns.flatMap((column) => {
      const old = source.columns.find((candidate) => candidate.id === column.id)
      return old ? [{ old: old.physicalName, next: column.physicalName }] : []
    })
    if (!common.length)
      return failure(
        "unsupported",
        "SQLite rebuild requires shared source and target column identities to preserve rows",
        ["afterSnapshot", "tables"],
      )
    groups.push({
      operationIds: members.map((operation) => operation.id),
      statements: [
        rendered.create.replace(targetQualified, temporaryQualified),
        `INSERT INTO ${temporaryQualified} (${common.map((item) => quote(item.next)).join(", ")}) SELECT ${common.map((item) => quote(item.old)).join(", ")} FROM ${targetQualified}`,
        `DROP TABLE ${targetQualified}`,
        `ALTER TABLE ${temporaryQualified} RENAME TO ${quote(target.physicalName)}`,
        ...rendered.indexes,
      ],
      transaction: "required",
      lock: "exclusive",
      postconditions: [
        {
          id: `condition-rebuild-${groups.length}-post`,
          type: "object-present",
          value: {
            type: "object-present",
            path: ["tables"],
            kind: "table",
            namespace: after.namespace.name,
            logicalId: target.id,
            physicalName: target.physicalName,
          },
        },
      ],
    })
  }
  return { ok: true, groups }
}

function createStatements(
  snapshot: SchemaSnapshot,
  table: SnapshotTable,
  options: CompileMigrationProgramOptions,
):
  | { readonly ok: true; readonly create: string; readonly indexes: readonly string[] }
  | Extract<MigrationProgramCompilationResult, { readonly ok: false }> {
  const empty: SchemaSnapshot = {
    ...snapshot,
    tables: snapshot.tables.filter((candidate) => candidate.id !== table.id),
  }
  const planned = createMigrationPlan(diffSnapshots(empty, snapshot))
  if (!planned.ok)
    return failure("unsupported", `Could not plan SQLite rebuild table ${table.id}`, [
      "afterSnapshot",
      "tables",
    ]) as Extract<MigrationProgramCompilationResult, { readonly ok: false }>
  const compiled = compileGenericMigrationProgram(planned.plan, sqliteSchemaDialect, {
    columnOrder: options.columnOrder,
    serverVersion: options.serverVersion,
  })
  if (!compiled.ok) return compiled
  const statements = compiled.program.phases.flatMap((phase) =>
    phase.statements.map((item) => item.sql),
  )
  const qualifiedTable = qualify(snapshot.namespace.name, table.physicalName)
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

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function qualify(namespace: string | undefined, value: string): string {
  return namespace ? `${quote(namespace)}.${quote(value)}` : quote(value)
}
