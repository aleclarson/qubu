import type { Sha256Digest } from "@qubu/migrate/artifact"
import { type MigrationAdapter, type MigrationSnapshotInspection } from "@qubu/migrate/executor"
import type { ClientBase, QueryResultRow } from "pg"
import type { SchemaSnapshot } from "qubu/snapshot"

import { postgresMigrationAdapter } from "./migration-support.ts"

export interface PgMigrationAdapterOptions {
  readonly readSnapshot: (
    client: ClientBase,
    expected?: SchemaSnapshot,
  ) => Promise<SchemaSnapshot | Sha256Digest | MigrationSnapshotInspection>
  readonly serverVersion?: string
  readonly leasePollMilliseconds?: number
}

/** Adapt one already-pinned `pg` client. Pools must acquire and release the client themselves. */
export function pgMigrationAdapter(
  client: ClientBase,
  options: PgMigrationAdapterOptions,
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
    readSnapshot: (_connection, expected) => options.readSnapshot(client, expected),
  })
}
