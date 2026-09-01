import { postgresSchemaDialect } from "qubu/snapshot/postgres"

import type { MigrationPlan } from "../plan/index.ts"
import { createDdlEmitter } from "./emitter.ts"
import type { DdlEmission, DdlEmissionOptions, DdlEmitter } from "./types.ts"

/** PostgreSQL operation support used by the strict DDL preflight. */
export const postgresDdlEmitter: DdlEmitter = createDdlEmitter({
  dialect: "postgresql",
  supports: new Set([
    "namespace",
    "table",
    "column",
    "constraint",
    "index",
    "view",
    "materialized-view",
    "sequence",
    "enum",
    "domain",
    "collation",
    "trigger",
    "routine",
    "partition",
    "policy",
    "extension",
    "comment",
    "ownership",
    "generated-column",
    "index-predicate",
    "index-include",
  ]),
})

/** Emit a reviewed plan with PostgreSQL's schema dialect. */
export function emitMigrationPlan(plan: MigrationPlan, options?: DdlEmissionOptions): DdlEmission {
  return postgresDdlEmitter.emit(plan, postgresSchemaDialect, options)
}
