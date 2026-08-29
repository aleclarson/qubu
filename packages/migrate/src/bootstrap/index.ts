import { diffSnapshots } from "qubu/diff"
import { sqliteSchemaDialect, type SchemaSnapshot } from "qubu/snapshot"

import {
  compileMigrationProgram,
  type CompileMigrationProgramOptions,
  type MigrationProgram,
} from "../artifact/index.ts"
import { createMigrationPlan, type MigrationPlan } from "../plan/index.ts"

export type BootstrapPlanResult =
  | {
      readonly ok: true
      readonly beforeSnapshot: SchemaSnapshot
      readonly targetSnapshot: SchemaSnapshot
      readonly plan: MigrationPlan
      readonly program: MigrationProgram
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly { readonly code: string; readonly message: string }[]
    }

/** Plan a fresh database through the same diff, plan, and program compiler used by migrations. */
export function planSchemaBootstrap(
  targetSnapshot: SchemaSnapshot,
  options: CompileMigrationProgramOptions = {},
): BootstrapPlanResult {
  const beforeSnapshot: SchemaSnapshot = {
    format: "qubu-schema",
    version: 1,
    dialect: targetSnapshot.dialect,
    namingPolicy: targetSnapshot.namingPolicy,
    namespace: targetSnapshot.namespace,
    tables: [],
  }
  const planned = createMigrationPlan(diffSnapshots(beforeSnapshot, targetSnapshot))
  if (!planned.ok) return { ok: false, diagnostics: planned.diagnostics }
  if (targetSnapshot.dialect.name !== "sqlite")
    return {
      ok: false,
      diagnostics: [{ code: "unsupported", message: "Bootstrap currently supports SQLite" }],
    }
  const compiled = compileMigrationProgram(planned.plan, sqliteSchemaDialect, options)
  if (!compiled.ok) return compiled
  return Object.freeze({
    ok: true,
    beforeSnapshot,
    targetSnapshot,
    plan: planned.plan,
    program: compiled.program,
  })
}
