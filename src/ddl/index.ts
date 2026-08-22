import { mysqlSchemaDialect } from '../snapshot/mysql.ts'
import { postgresSchemaDialect } from '../snapshot/postgres.ts'
import { sqliteSchemaDialect } from '../snapshot/sqlite.ts'
import type { SchemaDialect } from '../schema/dialect.ts'
import type { MigrationPlan } from '../migration/index.ts'
import { mysqlDdlEmitter } from './mysql.ts'
import { postgresDdlEmitter } from './postgres.ts'
import { sqliteDdlEmitter } from './sqlite.ts'
import type { DdlEmission, DdlEmissionOptions, DdlEmitter } from './types.ts'

export * from './types.ts'
export * from './emitter.ts'
export * from './postgres.ts'
export * from './sqlite.ts'
export * from './mysql.ts'

/** Select a first-party emitter by the selected schema dialect name. */
export function ddlEmitterForDialect(dialect: SchemaDialect): DdlEmitter {
  if (dialect.name === 'postgresql') return postgresDdlEmitter
  if (dialect.name === 'sqlite') return sqliteDdlEmitter
  if (dialect.name === 'mysql') return mysqlDdlEmitter
  throw new TypeError(`No first-party DDL emitter exists for "${dialect.name}"`)
}

/** Emit a plan through the matching first-party schema dialect. */
export function emitMigrationPlan(
  plan: MigrationPlan,
  dialect: SchemaDialect,
  options?: DdlEmissionOptions
): DdlEmission {
  return ddlEmitterForDialect(dialect).emit(plan, dialect, options)
}

/** Convenient defaults for callers that already selected a plan dialect. */
export const ddlDialects = Object.freeze({
  postgresql: postgresSchemaDialect,
  sqlite: sqliteSchemaDialect,
  mysql: mysqlSchemaDialect,
})
