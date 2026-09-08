import { encodeBaselineArtifact } from "@qubu/migrate/artifact"
import type { BaselineAdapter } from "@qubu/migrate/baseline"
import { MigrationExecutionError } from "@qubu/migrate/executor"

import {
  initializeHistory,
  readCompletedIds,
  validateMigrationId,
  type MigrationConnection,
} from "./migration-history.ts"
import { readMigrationSnapshot, selectedNamespace } from "./migration-snapshot.ts"

/**
 * Adopt schemas through the shared baseline API on a dedicated mysql2 connection. The caller owns
 * the connection and must prevent concurrent migrations/DDL, enable autocommit, and have no active
 * transaction. History uses the basic SQL runner's table; no migration-executor capabilities or
 * database lease are implied. A lost insert response requires history inspection before retrying.
 */
export function baselineAdapter(connection: MigrationConnection): BaselineAdapter {
  return {
    async openBaselineSession(scope, signal) {
      await selectedNamespace(connection, scope, signal)
      // MySQL introspects collations used by journal columns, so initialize before capture.
      await initializeHistory(connection)
      return {
        dialect: "mysql",
        readSnapshot: (expected) => readMigrationSnapshot(connection, expected, signal),
        async assertEmptyHistory() {
          signal?.throwIfAborted()
          if ((await readCompletedIds(connection)).size) {
            throw new MigrationExecutionError(
              "policy",
              "A baseline requires empty MySQL migration history",
            )
          }
        },
        async recordBaseline(artifact) {
          signal?.throwIfAborted()
          validateMigrationId(artifact.id)
          await connection.execute({
            sql: "INSERT INTO __qubu_mysql2_migrations (id, hash, created_at, baseline) VALUES (?, ?, ?, ?)",
            values: [
              artifact.id,
              artifact.artifactDigest.slice("sha256:".length),
              Date.parse(artifact.verifiedAt),
              encodeBaselineArtifact(artifact),
            ],
            rowsAsArray: false,
            nestTables: false,
          })
        },
        async close() {},
      }
    },
  }
}
