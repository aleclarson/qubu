import { defineConfig } from "../src/config.ts"

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
  // @ts-expect-error environment names are explicit application policy
  environment: "preview",
})
