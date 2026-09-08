import type { Connection, PoolConnection } from "mysql2/promise"
import type { SchemaSnapshot } from "qubu/snapshot"
import { expectTypeOf } from "vitest"

import { baselineAdapter, readMigrationSnapshot } from "../adapters/mysql2/src/migration.ts"
import {
  captureBaseline,
  createBaseline,
  preflightBaseline,
  type BaselineAdapter,
  type BaselineResult,
  type CreateBaselineInput,
} from "../packages/migrate/src/baseline/index.ts"
import type { MigrationSnapshotInspection } from "../packages/migrate/src/executor/types.ts"

declare const connection: Connection
declare const pooled: PoolConnection
declare const scope: SchemaSnapshot
declare const candidate: SchemaSnapshot
declare const acceptance: CreateBaselineInput

expectTypeOf(baselineAdapter(connection)).toEqualTypeOf<BaselineAdapter>()
expectTypeOf(readMigrationSnapshot(connection)).toEqualTypeOf<
  Promise<MigrationSnapshotInspection>
>()
expectTypeOf(
  captureBaseline({
    adapter: baselineAdapter(pooled),
    scope,
  }),
).toEqualTypeOf<Promise<MigrationSnapshotInspection>>()
expectTypeOf(
  preflightBaseline({
    adapter: baselineAdapter(connection),
    scope,
    candidate,
    repository: [],
  }),
).toEqualTypeOf<Promise<MigrationSnapshotInspection>>()
expectTypeOf(createBaseline(acceptance)).toEqualTypeOf<Promise<BaselineResult>>()
// @ts-expect-error Preflight must retain the original managed scope.
preflightBaseline({
  adapter: baselineAdapter(connection),
  candidate,
  repository: [],
})
// @ts-expect-error Adoption adapters do not expose migration execution.
baselineAdapter(connection).openMigrationSession()
