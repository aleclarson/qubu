import { postgresSchemaDialect } from "qubu/snapshot/postgres"

import type { CompileMigrationProgramOptions } from "../artifact/index.ts"
import {
  planSchemaBootstrap as planSchemaBootstrapWithDialect,
  type BootstrapPlanResult,
  type BootstrapSnapshot,
} from "./index.ts"

/** Plan a fresh PostgreSQL database through the migration compiler. */
export function planSchemaBootstrap(
  targetSnapshot: BootstrapSnapshot,
  options: CompileMigrationProgramOptions = {},
): BootstrapPlanResult {
  return planSchemaBootstrapWithDialect(targetSnapshot, postgresSchemaDialect, options)
}

/** Alias with an explicit PostgreSQL name for codebases that import several planners. */
export const planPostgresSchemaBootstrap = planSchemaBootstrap
