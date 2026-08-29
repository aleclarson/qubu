import type { UnavailableMigrationAdapterProfile } from "@qubu/migrate/executor"

/** D1's binding does not expose the interactive pinned transaction required by MigrationSession. */
export const d1MigrationProfile = Object.freeze({
  status: "incompatible",
  reason: "The D1 binding has no pinned interactive transaction/session contract.",
  missingCapabilities: ["pinned-session", "transaction-control", "commit-ambiguity"],
} as const satisfies UnavailableMigrationAdapterProfile)
