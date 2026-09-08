import type { Connection, PoolConnection } from "mysql2/promise"
import type { SchemaSnapshot } from "qubu/snapshot"
import { expectTypeOf } from "vitest"

import {
  captureBaseline,
  createBaseline,
  preflightBaseline,
  readMigrationSnapshot,
  type CreateBaselineInput,
} from "../adapters/mysql2/src/migration.ts"
import type { BaselineResult } from "../packages/migrate/src/baseline/index.ts"
import type { MigrationSnapshotInspection } from "../packages/migrate/src/executor/types.ts"

declare const connection: Connection
declare const pooled: PoolConnection
declare const scope: SchemaSnapshot
declare const candidate: SchemaSnapshot
declare const acceptance: CreateBaselineInput

expectTypeOf(readMigrationSnapshot(connection)).toEqualTypeOf<
  Promise<MigrationSnapshotInspection>
>()
expectTypeOf(captureBaseline(pooled, { scope })).toEqualTypeOf<
  Promise<MigrationSnapshotInspection>
>()
expectTypeOf(
  preflightBaseline(connection, {
    scope,
    candidate,
    migrations: [],
  }),
).toEqualTypeOf<Promise<MigrationSnapshotInspection>>()
expectTypeOf(createBaseline(connection, acceptance)).toEqualTypeOf<Promise<BaselineResult>>()
// @ts-expect-error Preflight must retain the original managed scope.
preflightBaseline(connection, {
  candidate,
  migrations: [],
})
// @ts-expect-error Acceptance requires operator acknowledgments.
createBaseline(connection, {
  scope,
  candidate,
  migrations: [],
  id: "initial",
  provenance: { source: "test" },
})
