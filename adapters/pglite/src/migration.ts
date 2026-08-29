import type { PGliteInterface, Row } from "@electric-sql/pglite"
import type { Sha256Digest } from "@qubu/migrate/artifact"
import { type MigrationAdapter, type MigrationSnapshotInspection } from "@qubu/migrate/executor"
import type { SchemaSnapshot } from "qubu/snapshot"

import { postgresMigrationAdapter } from "../../pg/src/migration-support.ts"

export interface PgliteMigrationAdapterOptions {
  readonly readSnapshot: (
    database: PGliteInterface,
    expected?: SchemaSnapshot,
  ) => Promise<SchemaSnapshot | Sha256Digest | MigrationSnapshotInspection>
  readonly serverVersion?: string
  readonly leasePollMilliseconds?: number
}

/** Adapt one application-owned PGlite database, whose query queue is the pinned session. */
export function pgliteMigrationAdapter(
  database: PGliteInterface,
  options: PgliteMigrationAdapterOptions,
): MigrationAdapter {
  return postgresMigrationAdapter({
    ...options,
    async openConnection() {
      return {
        async query(sql, parameters = []) {
          const result = await database.query<Row>(sql, [...parameters])

          return {
            rows: result.rows,
            ...((result.rowCount ?? result.affectedRows) === undefined
              ? {}
              : { affectedRows: result.rowCount ?? result.affectedRows }),
          }
        },
      }
    },
    readSnapshot: (_connection, expected) => options.readSnapshot(database, expected),
  })
}
