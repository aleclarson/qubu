import type { Sha256Digest } from "@qubu/migrate/artifact"
import { fromMigrationAdapter, type BaselineAdapter } from "@qubu/migrate/baseline"
import {
  type MigrationAdapter,
  type MigrationSnapshot,
  type MigrationSnapshotInspection,
} from "@qubu/migrate/executor"
import type { ReservedSql, Row, Sql } from "postgres"

import {
  postgresMigrationAdapter,
  type PostgresMigrationConnection,
} from "../../pg/src/migration-support.ts"

export interface PostgresJsMigrationAdapterOptions {
  readonly readSnapshot: (
    connection: ReservedSql,
    expected?: MigrationSnapshot,
  ) => Promise<MigrationSnapshot | Sha256Digest | MigrationSnapshotInspection>
  readonly serverVersion?: string
  readonly leasePollMilliseconds?: number
}

/** Reserve one postgres.js connection for the complete migration lifecycle. */
export function migrationAdapter(
  sql: Sql,
  options: PostgresJsMigrationAdapterOptions,
): MigrationAdapter {
  const reservedByConnection = new WeakMap<PostgresMigrationConnection, ReservedSql>()

  return postgresMigrationAdapter({
    ...options,
    async openConnection(signal) {
      const connection = await sql.reserve()

      try {
        signal?.throwIfAborted()
      } catch (error) {
        connection.release()
        throw error
      }
      const handle: PostgresMigrationConnection = {
        async query(text, parameters = []) {
          const result = await connection.unsafe<Row[]>(text, [...parameters] as never[])

          return {
            rows: Array.from(result),
            affectedRows: result.count,
          }
        },
        async close() {
          connection.release()
        },
      }

      reservedByConnection.set(handle, connection)
      return handle
    },
    readSnapshot: (handle, expected) => {
      const reserved = reservedByConnection.get(handle)

      if (!reserved) {
        throw new Error("Postgres.js migration connection is not reserved")
      }

      return options.readSnapshot(reserved, expected)
    },
  })
}

/** Use this adapter's strict inspection, lease, and journal through the shared adoption API. */
export function baselineAdapter(
  sql: Sql,
  options: PostgresJsMigrationAdapterOptions,
): BaselineAdapter {
  return fromMigrationAdapter(migrationAdapter(sql, options))
}
