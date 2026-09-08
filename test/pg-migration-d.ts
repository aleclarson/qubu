import type { Client, Pool, PoolClient } from "pg"
import { expectTypeOf } from "vitest"

import { migrationAdapter, readMigrationSnapshot } from "../adapters/pg/src/migration.ts"
import type {
  MigrationAdapter,
  MigrationSnapshotInspection,
} from "../packages/migrate/src/executor/index.ts"

declare const client: Client
declare const pinned: PoolClient
declare const pool: Pool

expectTypeOf(migrationAdapter(client)).toMatchTypeOf<MigrationAdapter>()
expectTypeOf(migrationAdapter(pinned, {})).toMatchTypeOf<MigrationAdapter>()
expectTypeOf(readMigrationSnapshot(client)).toEqualTypeOf<Promise<MigrationSnapshotInspection>>()
migrationAdapter(client, {
  readSnapshot: (connection, expected) => readMigrationSnapshot(connection, expected),
})
// @ts-expect-error Migration sessions require an already-pinned connection.
migrationAdapter(pool)
