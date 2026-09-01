import { postgresSchemaDialect } from "qubu/snapshot/postgres"

import type { MigrationPlan } from "../plan/index.ts"
import { compileMigrationProgram, type CompileMigrationProgramOptions } from "./program.ts"
import type { MigrationProgramCompilationResult } from "./types.ts"

/** Compile a reviewed migration plan with PostgreSQL's schema dialect. */
export function compilePostgresMigrationProgram(
  plan: MigrationPlan,
  options?: CompileMigrationProgramOptions,
): MigrationProgramCompilationResult {
  return compileMigrationProgram(plan, postgresSchemaDialect, options)
}
