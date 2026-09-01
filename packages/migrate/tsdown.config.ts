import { defineConfig } from "tsdown"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    artifact: "src/artifact/index.ts",
    "artifact/mysql": "src/artifact/mysql.ts",
    "artifact/postgres": "src/artifact/postgres.ts",
    "artifact/sqlite": "src/artifact/sqlite.ts",
    baseline: "src/baseline/index.ts",
    bootstrap: "src/bootstrap/index.ts",
    "bootstrap/postgres": "src/bootstrap/postgres.ts",
    "bootstrap/sqlite": "src/bootstrap/sqlite.ts",
    plan: "src/plan/index.ts",
    ddl: "src/ddl/index.ts",
    "ddl/mysql": "src/ddl/mysql.ts",
    "ddl/postgres": "src/ddl/postgres.ts",
    "ddl/sqlite": "src/ddl/sqlite.ts",
    executor: "src/executor/index.ts",
    journal: "src/journal/index.ts",
    testing: "src/testing/index.ts",
    repository: "src/repository/index.ts",
    status: "src/status/index.ts",
  },
  format: "esm",
  fixedExtension: true,
  dts: true,
  clean: true,
  exports: {
    devExports: true,
    customExports(exports, { isPublish }) {
      if (isPublish) {
        for (const [subpath, target] of Object.entries(exports)) {
          if (typeof target !== "string" || !target.endsWith(".mjs")) {
            continue
          }

          exports[subpath] = {
            types: target.replace(/\.mjs$/, ".d.mts"),
            import: target,
          }
        }
      }

      return exports
    },
  },
})
