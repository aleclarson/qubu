import type { UnavailableMigrationAdapterProfile } from "@qubu/migrate/executor"

import type { Mysql2Connection } from "./index.ts"

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
export async function migrateMysql2(
  connection: Pick<Mysql2Connection, "execute">,
  migrations: readonly Mysql2Migration[],
): Promise<Mysql2MigrationResult> {
  const ids = new Set<string>()

  // Validate the entire list before creating history or executing migration SQL.
  for (const migration of migrations) {
    if (
      !migration.id ||
      migration.id.trim() !== migration.id ||
      [...migration.id].length > 255 ||
      ids.has(migration.id)
    ) {
      throw new TypeError(
        "MySQL migration IDs must be unique, trimmed, non-empty, and at most 255 characters",
      )
    }

    if (migration.sql.some((statement) => !statement.trim())) {
      throw new TypeError("MySQL migration statements must not be empty")
    }

    ids.add(migration.id)
  }

  await connection.execute({
    sql: `CREATE TABLE IF NOT EXISTS __qubu_mysql2_migrations (
      id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
      hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_at BIGINT NOT NULL
    ) ENGINE=InnoDB`,
    values: [],
    rowsAsArray: false,
    nestTables: false,
  })
  const [rows] = await connection.execute({
    sql: "SELECT id FROM __qubu_mysql2_migrations",
    values: [],
    rowsAsArray: false,
    nestTables: false,
  })

  if (!Array.isArray(rows)) {
    throw new TypeError("MySQL migration history must return object rows")
  }

  const completed = new Set<string>()

  for (const row of rows) {
    if (
      typeof row !== "object" ||
      row === null ||
      Array.isArray(row) ||
      typeof row.id !== "string"
    ) {
      throw new TypeError("MySQL migration history contains an invalid ID")
    }

    completed.add(row.id)
  }

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

/** The shared executor profile remains unavailable. Use migrateMysql2 for basic SQL migrations. */
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
