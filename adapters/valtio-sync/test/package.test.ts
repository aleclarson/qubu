import { readFileSync } from "node:fs"

import * as integration from "@qubu/valtio-sync"
import { expect, test } from "vitest"

type PackageManifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports: Record<string, unknown>
  peerDependencies?: Record<string, string>
  publishConfig: { exports: Record<string, unknown> }
}

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as PackageManifest
const rootManifest = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as PackageManifest
const source = ["index", "schema", "server"]
  .map((file) => readFileSync(new URL(`../src/${file}.ts`, import.meta.url), "utf8"))
  .join("\n")

test("publishes the optional Valtio Sync integration as its own package", () => {
  expect(integration).toHaveProperty("applyOpsWithQubu")
  expect(integration).toHaveProperty("defineCollection")
  expect(manifest.exports).toMatchObject({
    ".": "./src/index.ts",
    "./package.json": "./package.json",
  })
  expect(manifest.publishConfig.exports).toMatchObject({
    ".": "./dist/index.mjs",
    "./package.json": "./package.json",
  })
  expect(manifest.peerDependencies).toMatchObject({
    qubu: "0.5.1",
    "valtio-sync": ">=0.3.1 <0.4.0",
  })
})

test("keeps Valtio Sync and Drizzle ownership outside the root Qubu package", () => {
  expect(source).not.toMatch(/drizzle-orm|valtio-sync\/drizzle/)
  expect(rootManifest.exports).not.toHaveProperty("./valtio-sync")
  expect(rootManifest.dependencies ?? {}).not.toHaveProperty("valtio-sync")
  expect(rootManifest.devDependencies ?? {}).not.toHaveProperty("valtio-sync")
  expect(rootManifest.peerDependencies ?? {}).not.toHaveProperty("valtio-sync")
  expect(manifest.dependencies ?? {}).not.toHaveProperty("drizzle-orm")
  expect(manifest.devDependencies ?? {}).not.toHaveProperty("drizzle-orm")
  expect(manifest.peerDependencies ?? {}).not.toHaveProperty("drizzle-orm")
})
