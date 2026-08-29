import type { MigrationAdapter, MigrationSession } from "@qubu/migrate/executor"

declare const session: MigrationSession
const adapter: MigrationAdapter = {
  async openMigrationSession() {
    return session
  },
}
void adapter

session.execute("SELECT ?", [{ type: "bigint", value: "42" }])
// @ts-expect-error raw values cannot cross the canonical tagged-parameter boundary
session.execute("SELECT ?", [42])
// @ts-expect-error unresolved transaction requirements are never adapter capabilities
session.capabilities.transactionalDdl = "unknown"
