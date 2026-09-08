import type { Client, Pool, PoolClient } from "pg"
import { expectTypeOf } from "vitest"

import { pgMigrationAdapter, readPgMigrationSnapshot } from "../adapters/pg/src/migration.ts"
import type {
  MigrationAdapter,
  MigrationSnapshotInspection,
} from "../packages/migrate/src/executor/index.ts"

declare const client: Client
declare const pinned: PoolClient
declare const pool: Pool

expectTypeOf(pgMigrationAdapter(client)).toMatchTypeOf<MigrationAdapter>()
expectTypeOf(pgMigrationAdapter(pinned, {})).toMatchTypeOf<MigrationAdapter>()
expectTypeOf(readPgMigrationSnapshot(client)).toEqualTypeOf<Promise<MigrationSnapshotInspection>>()
pgMigrationAdapter(client, {
  readSnapshot: (connection, expected) => readPgMigrationSnapshot(connection, expected),
})
// @ts-expect-error Migration sessions require an already-pinned connection.
pgMigrationAdapter(pool)
