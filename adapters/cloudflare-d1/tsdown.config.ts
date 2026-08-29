import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/migration.ts"],
  format: "esm",
  fixedExtension: true,
  dts: true,
  exports: { devExports: true },
})
