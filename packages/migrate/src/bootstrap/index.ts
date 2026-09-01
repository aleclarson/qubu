import { diffSnapshots } from "qubu/diff"
import type { SchemaDialect } from "qubu/schema"
import type { CompleteSchemaSnapshot, SchemaSnapshot } from "qubu/snapshot"

import {
  compileMigrationProgram,
  type CompileMigrationProgramOptions,
  type MigrationProgram,
} from "../artifact/index.ts"
import { createMigrationPlan, type MigrationPlan } from "../plan/index.ts"

export type BootstrapSnapshot = SchemaSnapshot | CompleteSchemaSnapshot

export type BootstrapPreparationResult =
  | {
      readonly ok: true
      readonly beforeSnapshot: BootstrapSnapshot
      readonly targetSnapshot: BootstrapSnapshot
      readonly plan: MigrationPlan
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly { readonly code: string; readonly message: string }[]
    }

export type BootstrapPlanResult =
  | (Extract<BootstrapPreparationResult, { readonly ok: true }> & {
      readonly program: MigrationProgram
    })
  | Extract<BootstrapPreparationResult, { readonly ok: false }>

/** Prepare a fresh database diff and reviewed plan without bypassing program approvals. */
export function prepareSchemaBootstrap(
  targetSnapshot: BootstrapSnapshot,
): BootstrapPreparationResult {
  const beforeSnapshot = emptySnapshot(targetSnapshot)

  if (!isSupportedBootstrapDialect(targetSnapshot.dialect.name)) return unsupportedDialect()

  const planned = createMigrationPlan(diffSnapshots(beforeSnapshot, targetSnapshot), {
    allowUnknown: true,
    allowLossy: true,
    allowUnsupported: true,
    allowDestructive: true,
    allowReviewRequired: true,
  })
  if (!planned.ok) return { ok: false, diagnostics: planned.diagnostics }

  return Object.freeze({
    ok: true,
    beforeSnapshot,
    targetSnapshot,
    plan: planned.plan,
  })
}

/** Plan a fresh database through the same diff, plan, and program compiler used by migrations. */
export function planSchemaBootstrap(
  targetSnapshot: BootstrapSnapshot,
  schemaDialect: SchemaDialect,
  options: CompileMigrationProgramOptions = {},
): BootstrapPlanResult {
  const prepared = prepareSchemaBootstrap(targetSnapshot)
  if (!prepared.ok) return prepared
  const compiled = compileMigrationProgram(prepared.plan, schemaDialect, options)
  if (!compiled.ok) return compiled
  return Object.freeze({
    ...prepared,
    program: compiled.program,
  })
}

function isSupportedBootstrapDialect(name: string): boolean {
  return name === "sqlite" || name === "postgresql"
}

function unsupportedDialect(): Extract<BootstrapPreparationResult, { readonly ok: false }> {
  return {
    ok: false,
    diagnostics: [
      { code: "unsupported", message: "Bootstrap currently supports SQLite and PostgreSQL" },
    ],
  }
}

function emptySnapshot(target: BootstrapSnapshot): BootstrapSnapshot {
  if (target.version === 1) {
    return {
      format: "qubu-schema",
      version: 1,
      dialect: target.dialect,
      namingPolicy: target.namingPolicy,
      namespace: target.namespace,
      tables: [],
    }
  }

  return {
    format: "qubu-schema",
    version: 2,
    dialect: target.dialect,
    namingPolicy: target.namingPolicy,
    namespace: target.namespace,
    capabilities: target.capabilities,
    tables: [],
    views: [],
    sequences: [],
    enums: [],
    domains: [],
    collations: [],
    triggers: [],
    routines: [],
    partitions: [],
    policies: [],
    extensions: [],
    deferredObjects: [],
    opaqueObjects: [],
    comments: [],
    ownership: [],
  }
}
