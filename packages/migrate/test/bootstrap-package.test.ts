import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import * as bootstrap from "@qubu/migrate/bootstrap"
import * as postgresBootstrap from "@qubu/migrate/bootstrap/postgres"
import * as sqliteBootstrap from "@qubu/migrate/bootstrap/sqlite"
import { expect, test } from "vitest"

import buildConfig from "../tsdown.config.ts"

type PackageManifest = {
  exports: Record<string, string>
  publishConfig: {
    exports: Record<string, string | { types: string; import?: string }>
  }
}

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))
const manifest = JSON.parse(
  readFileSync(resolve(packageRoot, "package.json"), "utf8"),
) as PackageManifest

test("publishes dedicated bootstrap entrypoints for each supported dialect", () => {
  expect(bootstrap.prepareSchemaBootstrap).toBeTypeOf("function")
  expect(postgresBootstrap.planSchemaBootstrap).toBeTypeOf("function")
  expect(sqliteBootstrap.planSchemaBootstrap).toBeTypeOf("function")

  expect(manifest.exports).toMatchObject({
    "./bootstrap": "./src/bootstrap/index.ts",
    "./bootstrap/postgres": "./src/bootstrap/postgres.ts",
    "./bootstrap/sqlite": "./src/bootstrap/sqlite.ts",
  })
  expect(manifest.publishConfig.exports).toMatchObject({
    "./bootstrap": {
      types: "./dist/bootstrap.d.mts",
      import: "./dist/bootstrap.mjs",
    },
    "./bootstrap/postgres": {
      types: "./dist/bootstrap/postgres.d.mts",
      import: "./dist/bootstrap/postgres.mjs",
    },
    "./bootstrap/sqlite": {
      types: "./dist/bootstrap/sqlite.d.mts",
      import: "./dist/bootstrap/sqlite.mjs",
    },
  })
  expect(buildConfig.entry).toMatchObject({
    bootstrap: "src/bootstrap/index.ts",
    "bootstrap/postgres": "src/bootstrap/postgres.ts",
    "bootstrap/sqlite": "src/bootstrap/sqlite.ts",
  })
})

test("keeps bootstrap dialect imports isolated by entrypoint", () => {
  const entrypoints = [
    ["index", []],
    ["postgres", ["postgres"]],
    ["sqlite", ["sqlite"]],
  ] as const

  for (const [entrypoint, expected] of entrypoints) {
    const source = readFileSync(resolve(packageRoot, "src/bootstrap", `${entrypoint}.ts`), "utf8")
    const imports = [
      ...source.matchAll(/from\s+["']qubu\/snapshot\/(mysql|postgres|sqlite)["']/g),
    ].map((match) => match[1])

    expect(imports, entrypoint).toEqual(expected)
  }
})
