import type { CompleteSchemaSnapshot } from "qubu/snapshot"

import { defineConfig } from "../src/config.ts"

declare const completePostgresSnapshot: CompleteSchemaSnapshot

defineConfig({
  artifacts: "migrations",
  environment: "production",
  adapter: async () => ({
    async openMigrationSession() {
      throw new Error("type fixture")
    },
  }),
})

defineConfig({
  artifacts: "migrations",
  snapshot: completePostgresSnapshot,
})

defineConfig({
  artifacts: "migrations",
  // @ts-expect-error environment names are explicit application policy
  environment: "preview",
})
