import { sqliteSchemaDialect } from "qubu/snapshot/sqlite"

import type { CompileMigrationProgramOptions } from "../artifact/index.ts"
import {
  planSchemaBootstrap as planSchemaBootstrapWithDialect,
  type BootstrapPlanResult,
  type BootstrapSnapshot,
} from "./index.ts"

/** Plan a fresh SQLite database through the migration compiler. */
export function planSchemaBootstrap(
  targetSnapshot: BootstrapSnapshot,
  options: CompileMigrationProgramOptions = {},
): BootstrapPlanResult {
  return planSchemaBootstrapWithDialect(targetSnapshot, sqliteSchemaDialect, options)
}
