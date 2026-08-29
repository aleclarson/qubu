import { defineConfig } from "tsdown"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    plan: "src/plan/index.ts",
    ddl: "src/ddl/index.ts",
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
