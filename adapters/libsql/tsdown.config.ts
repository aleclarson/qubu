import { defineConfig } from "tsdown"

import config from "../tsdown.config.ts"

export default defineConfig({
  ...config,
  entry: ["src/index.ts", "src/migration.ts"],
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
