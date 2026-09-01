import type { MigrationAdapter, MigrationSession, MigrationSnapshot } from "@qubu/migrate/executor"
import type { CompleteSchemaSnapshot } from "qubu/snapshot"

declare const session: MigrationSession
declare const completeSnapshot: CompleteSchemaSnapshot
const migrationSnapshot: MigrationSnapshot = completeSnapshot
const adapter: MigrationAdapter = {
  async openMigrationSession() {
    return session
  },
}
void [adapter, migrationSnapshot]

session.currentSnapshotDigest(completeSnapshot)

session.execute("SELECT ?", [{ type: "bigint", value: "42" }])
// @ts-expect-error raw values cannot cross the canonical tagged-parameter boundary
session.execute("SELECT ?", [42])
// @ts-expect-error unresolved transaction requirements are never adapter capabilities
session.capabilities.transactionalDdl = "unknown"
