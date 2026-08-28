import { defineConfig } from "tsdown"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    mysql: "src/mysql.ts",
    postgres: "src/postgres.ts",
    sqlite: "src/sqlite.ts",
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
