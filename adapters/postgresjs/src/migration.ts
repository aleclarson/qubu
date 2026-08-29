import type { Sha256Digest } from "@qubu/migrate/artifact"
import { type MigrationAdapter, type MigrationSnapshotInspection } from "@qubu/migrate/executor"
import type { ReservedSql, Row, Sql } from "postgres"
import type { SchemaSnapshot } from "qubu/snapshot"

import { postgresMigrationAdapter } from "../../pg/src/migration-support.ts"

export interface PostgresJsMigrationAdapterOptions {
  readonly readSnapshot: (
    connection: ReservedSql,
    expected?: SchemaSnapshot,
  ) => Promise<SchemaSnapshot | Sha256Digest | MigrationSnapshotInspection>
  readonly serverVersion?: string
  readonly leasePollMilliseconds?: number
}

/** Reserve one postgres.js connection for the complete migration lifecycle. */
export function postgresJsMigrationAdapter(
  sql: Sql,
  options: PostgresJsMigrationAdapterOptions,
): MigrationAdapter {
  let reserved: ReservedSql | undefined

  return postgresMigrationAdapter({
    ...options,
    async openConnection() {
      reserved = await sql.reserve()
      const connection = reserved

      return {
        async query(text, parameters = []) {
          const result = await connection.unsafe<Row[]>(text, [...parameters] as never[])

          return {
            rows: Array.from(result),
            affectedRows: result.count,
          }
        },
        async close() {
          connection.release()
          if (reserved === connection) {
            reserved = undefined
          }
        },
      }
    },
    readSnapshot: (_connection, expected) => {
      if (!reserved) {
        throw new Error("Postgres.js migration connection is not reserved")
      }
      return options.readSnapshot(reserved, expected)
    },
  })
}
