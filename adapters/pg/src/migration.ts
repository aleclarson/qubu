import type { Sha256Digest } from "@qubu/migrate/artifact"
import { fromMigrationAdapter, type BaselineAdapter } from "@qubu/migrate/baseline"
import {
  type MigrationAdapter,
  type MigrationSnapshot,
  type MigrationSnapshotInspection,
} from "@qubu/migrate/executor"
import type { ClientBase, QueryResultRow } from "pg"

import { readMigrationSnapshot } from "./migration-snapshot.ts"
import { postgresMigrationAdapter } from "./migration-support.ts"

export { readMigrationSnapshot } from "./migration-snapshot.ts"

/** Inspection and session settings for one caller-owned pinned PostgreSQL client. */
export interface PgMigrationAdapterOptions {
  /** Override strict standard inspection; the caller owns scope and journal exclusions. */
  readonly readSnapshot?: (
    client: ClientBase,
    expected?: MigrationSnapshot,
  ) => Promise<MigrationSnapshot | Sha256Digest | MigrationSnapshotInspection>
  readonly serverVersion?: string
  readonly leasePollMilliseconds?: number
}

/** Adapt one already-pinned `pg` client. Pools must acquire and release the client themselves. */
export function migrationAdapter(
  client: ClientBase,
  options: PgMigrationAdapterOptions = {},
): MigrationAdapter {
  return postgresMigrationAdapter({
    ...options,
    async openConnection() {
      return {
        async query(sql, parameters = []) {
          const result = await client.query<QueryResultRow>(sql, [...parameters])

          return {
            rows: result.rows,
            ...(result.rowCount === null ? {} : { affectedRows: result.rowCount }),
          }
        },
      }
    },
    readSnapshot: (_connection, expected) =>
      (options.readSnapshot ?? readMigrationSnapshot)(client, expected),
  })
}

/** Use this adapter's strict inspection, lease, and journal through the shared adoption API. */
export function baselineAdapter(
  client: ClientBase,
  options: PgMigrationAdapterOptions = {},
): BaselineAdapter {
  return fromMigrationAdapter(migrationAdapter(client, options))
}
