import type { UnavailableMigrationAdapterProfile } from "@qubu/migrate/executor"

/**
 * MySQL migration support stays unavailable until its implicit-commit recovery profile is
 * live-proven.
 */
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
