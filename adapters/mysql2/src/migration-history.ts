import type { Mysql2Connection } from "./index.ts"

export type MigrationConnection = Pick<Mysql2Connection, "execute">

export async function initializeHistory(connection: MigrationConnection): Promise<void> {
  await connection.execute({
    sql: `CREATE TABLE IF NOT EXISTS __qubu_mysql2_migrations (
      id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
      hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_at BIGINT NOT NULL,
      baseline LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
    ) ENGINE=InnoDB`,
    values: [],
    rowsAsArray: false,
    nestTables: false,
  })
}

export function validateMigrationId(id: string): void {
  if (!id || id.trim() !== id || [...id].length > 255) {
    throw new TypeError(
      "MySQL migration IDs must be trimmed, non-empty, and at most 255 characters",
    )
  }
}

export async function readCompletedIds(connection: MigrationConnection): Promise<Set<string>> {
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

  return completed
}
