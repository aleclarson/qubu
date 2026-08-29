import type { UnavailableMigrationAdapterProfile } from "@qubu/migrate/executor"

/** Bun.SQL/SQLite remains outside stable migration claims pending a Bun-native live suite. */
export const bunSqliteMigrationProfile = Object.freeze({
  status: "not-yet-written",
  reason: "A Bun-native pinned-session and journal conformance run has not been added.",
  missingCapabilities: ["migrator-lease", "ddl-lock", "journal-head-cas", "commit-ambiguity"],
} as const satisfies UnavailableMigrationAdapterProfile)
