import { postgresSchemaDialect } from '../snapshot/postgres.ts'
import { createDdlEmitter } from './emitter.ts'
import type { DdlEmission, DdlEmissionOptions, DdlEmitter } from './types.ts'
import type { MigrationPlan } from '../migration/index.ts'

/** PostgreSQL operation support used by the strict DDL preflight. */
export const postgresDdlEmitter: DdlEmitter = createDdlEmitter({
  dialect: 'postgresql',
  supports: new Set([
    'namespace',
    'table',
    'column',
    'constraint',
    'index',
    'view',
    'materialized-view',
    'sequence',
    'enum',
    'domain',
    'collation',
    'trigger',
    'routine',
    'partition',
    'policy',
    'extension',
    'comment',
    'ownership',
    'generated-column',
    'index-predicate',
    'index-include',
  ]),
})

/** Emit a reviewed plan with PostgreSQL's schema dialect. */
export function emitPostgresMigrationPlan(
  plan: MigrationPlan,
  options?: DdlEmissionOptions
): DdlEmission {
  return postgresDdlEmitter.emit(plan, postgresSchemaDialect, options)
}

/** Alias using the full PostgreSQL spelling. */
export const emitPostgresqlMigrationPlan = emitPostgresMigrationPlan
export const emitPostgresDdl = emitPostgresMigrationPlan
export const emitPostgresqlDdl = emitPostgresMigrationPlan
