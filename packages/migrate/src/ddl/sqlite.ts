import { sqliteSchemaDialect } from "qubu/snapshot/sqlite"

import type { MigrationPlan } from "../plan/index.ts"
import { createDdlEmitter } from "./emitter.ts"
import type { DdlEmission, DdlEmissionOptions, DdlEmitter } from "./types.ts"

/** SQLite operation support used by the strict DDL preflight. */
export const sqliteDdlEmitter: DdlEmitter = createDdlEmitter({
  dialect: "sqlite",
  supports: new Set([
    "table",
    "column",
    "constraint",
    "index",
    "view",
    "trigger",
    "generated-column",
    "index-predicate",
  ]),
})

/** Emit a reviewed plan with SQLite's schema dialect. */
export function emitSqliteMigrationPlan(
  plan: MigrationPlan,
  options?: DdlEmissionOptions,
): DdlEmission {
  return sqliteDdlEmitter.emit(plan, sqliteSchemaDialect, options)
}

export const emitSqliteDdl = emitSqliteMigrationPlan
