import { mysqlSchemaDialect } from "qubu/snapshot/mysql"

import type { MigrationPlan } from "../plan/index.ts"
import { compileMigrationProgram, type CompileMigrationProgramOptions } from "./program.ts"
import type { MigrationProgramCompilationResult } from "./types.ts"

/** Compile a reviewed migration plan with MySQL's schema dialect. */
export function compileMysqlMigrationProgram(
  plan: MigrationPlan,
  options?: CompileMigrationProgramOptions,
): MigrationProgramCompilationResult {
  return compileMigrationProgram(plan, mysqlSchemaDialect, options)
}
