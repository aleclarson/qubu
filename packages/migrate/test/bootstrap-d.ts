import type { CompleteSchemaSnapshot } from "qubu/snapshot"
import { expectTypeOf } from "vitest"

import { planSchemaBootstrap, prepareSchemaBootstrap } from "../src/bootstrap/index.ts"

declare const completePostgresSnapshot: CompleteSchemaSnapshot

const result = planSchemaBootstrap(completePostgresSnapshot)
const prepared = prepareSchemaBootstrap(completePostgresSnapshot)

if (result.ok) {
  expectTypeOf(result.targetSnapshot).toEqualTypeOf<
    import("../src/bootstrap/index.ts").BootstrapSnapshot
  >()
}

if (prepared.ok) expectTypeOf(prepared.plan.dialect.name).toEqualTypeOf<string>()
