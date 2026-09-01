import { postgresSchemaDialect } from "qubu/snapshot/postgres"

import type { MigrationPlan } from "../plan/index.ts"
import {
  compileMigrationProgram as compileGenericMigrationProgram,
  type CompileMigrationProgramOptions,
} from "./program.ts"
import type { MigrationProgramCompilationResult } from "./types.ts"

/** Compile a reviewed migration plan with PostgreSQL's schema dialect. */
export function compileMigrationProgram(
  plan: MigrationPlan,
  options?: CompileMigrationProgramOptions,
): MigrationProgramCompilationResult {
  return compileGenericMigrationProgram(plan, postgresSchemaDialect, options)
}
