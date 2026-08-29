import type { SchemaDialect } from "qubu/schema"

import type { DdlEmission, DdlEmissionOptions, DdlEmitter } from "../src/ddl/index.ts"
import { ddlEmitterForDialect, emitMigrationPlan } from "../src/ddl/index.ts"
import type { MigrationPlan } from "../src/plan/index.ts"

declare const plan: MigrationPlan
declare const dialect: SchemaDialect
declare const options: DdlEmissionOptions

const emitter: DdlEmitter = ddlEmitterForDialect(dialect)
const emission: DdlEmission = emitMigrationPlan(plan, dialect, options)
const diagnostics = emitter.diagnose(plan, dialect, options)
const statements: readonly DdlEmission["statements"][number][] = emission.statements

void diagnostics
void statements
