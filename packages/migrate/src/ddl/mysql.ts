import { mysqlSchemaDialect } from "qubu/snapshot"

import type { MigrationPlan } from "../plan/index.ts"
import { createDdlEmitter } from "./emitter.ts"
import type { DdlEmission, DdlEmissionOptions, DdlEmitter } from "./types.ts"

/** MySQL operation support used by the strict DDL preflight. */
export const mysqlDdlEmitter: DdlEmitter = createDdlEmitter({
  dialect: "mysql",
  supports: new Set([
    "table",
    "column",
    "constraint",
    "index",
    "view",
    "routine",
    "partition",
    "trigger",
    "comment",
    "generated-column",
  ]),
})

/** Emit a reviewed plan with MySQL's schema dialect. */
export function emitMysqlMigrationPlan(
  plan: MigrationPlan,
  options?: DdlEmissionOptions,
): DdlEmission {
  return mysqlDdlEmitter.emit(plan, mysqlSchemaDialect, options)
}

export const emitMysqlDdl = emitMysqlMigrationPlan
