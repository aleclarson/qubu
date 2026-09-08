import type { UnavailableMigrationAdapterProfile } from "@qubu/migrate/executor"

import type { Mysql2Connection } from "./index.ts"
import { initializeHistory, readCompletedIds, validateMigrationId } from "./migration-history.ts"

export { readMigrationSnapshot } from "./migration-snapshot.ts"
export {
  captureBaseline,
  preflightBaseline,
  createBaseline,
  type CaptureBaselineInput,
  type VerifyBaselineInput,
  type CreateBaselineInput,
} from "./migration-baseline.ts"

/** An append-only SQL migration for the basic MySQL runner. */
export interface Mysql2Migration {
  /** Unique, permanent ID. Supply the full migration list in application order. */
  readonly id: string
  /** One SQL statement per entry; statements run in array order. */
  readonly sql: readonly string[]
}

/** Migrations successfully recorded during one run. */
export interface Mysql2MigrationResult {
  /** IDs completed by this call, excluding previously recorded migrations. */
  readonly applied: readonly string[]
}

/**
 * Run pending SQL migrations on one application-owned mysql2 connection.
 *
 * Append new migrations to the list and never edit completed migrations. The caller must use a
 * dedicated connection with autocommit enabled and serialize runners. MySQL DDL commits implicitly:
 * failures can leave partial changes without a history record. Inspect and repair those changes
 * before retrying. There are no leases, statement checkpoints, schema checks, or automatic
 * recovery.
 */
export async function migrate(
  connection: Pick<Mysql2Connection, "execute">,
  migrations: readonly Mysql2Migration[],
): Promise<Mysql2MigrationResult> {
  const ids = new Set<string>()

  // Validate the entire list before creating history or executing migration SQL.
  for (const migration of migrations) {
    validateMigrationId(migration.id)
    if (ids.has(migration.id)) {
      throw new TypeError("MySQL migration IDs must be unique")
    }

    if (migration.sql.some((statement) => !statement.trim())) {
      throw new TypeError("MySQL migration statements must not be empty")
    }

    ids.add(migration.id)
  }

  await initializeHistory(connection)
  const completed = await readCompletedIds(connection)

  const applied: string[] = []

  for (const migration of migrations) {
    if (completed.has(migration.id)) {
      continue
    }

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(migration.sql)),
    )
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")

    for (const sql of migration.sql) {
      await connection.execute({
        sql,
        values: [],
        rowsAsArray: false,
        nestTables: false,
      })
    }

    await connection.execute({
      sql: "INSERT INTO __qubu_mysql2_migrations (id, hash, created_at) VALUES (?, ?, ?)",
      values: [migration.id, hash, Date.now()],
      rowsAsArray: false,
      nestTables: false,
    })
    applied.push(migration.id)
  }

  return { applied }
}

/** The shared executor profile remains unavailable. Use migrate for basic SQL migrations. */
export const mysql2MigrationProfile = Object.freeze({
  status: "not-yet-written",
  reason: "MySQL DDL implicit commits need live-proven lease, checkpoint, and recovery semantics.",
  missingCapabilities: [
    "migrator-lease",
    "ddl-lock",
    "journal-head-cas",
    "commit-ambiguity",
    "forbidden-phases",
  ],
} as const satisfies UnavailableMigrationAdapterProfile)
