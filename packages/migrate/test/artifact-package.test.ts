import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import * as artifact from "@qubu/migrate/artifact"
import * as mysqlArtifact from "@qubu/migrate/artifact/mysql"
import * as postgresArtifact from "@qubu/migrate/artifact/postgres"
import * as sqliteArtifact from "@qubu/migrate/artifact/sqlite"
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

test("publishes dedicated artifact entrypoints for each dialect", () => {
  expect(artifact.compileMigrationProgram).toBeTypeOf("function")
  expect(mysqlArtifact.compileMysqlMigrationProgram).toBeTypeOf("function")
  expect(postgresArtifact.compilePostgresMigrationProgram).toBeTypeOf("function")
  expect(sqliteArtifact.compileSqliteMigrationProgram).toBeTypeOf("function")
  expect(artifact).not.toHaveProperty("compileMysqlMigrationProgram")
  expect(artifact).not.toHaveProperty("compilePostgresMigrationProgram")
  expect(artifact).not.toHaveProperty("compileSqliteMigrationProgram")

  expect(manifest.exports).toMatchObject({
    "./artifact": "./src/artifact/index.ts",
    "./artifact/mysql": "./src/artifact/mysql.ts",
    "./artifact/postgres": "./src/artifact/postgres.ts",
    "./artifact/sqlite": "./src/artifact/sqlite.ts",
  })
  expect(manifest.publishConfig.exports).toMatchObject({
    "./artifact": {
      types: "./dist/artifact.d.mts",
      import: "./dist/artifact.mjs",
    },
    "./artifact/mysql": {
      types: "./dist/artifact/mysql.d.mts",
      import: "./dist/artifact/mysql.mjs",
    },
    "./artifact/postgres": {
      types: "./dist/artifact/postgres.d.mts",
      import: "./dist/artifact/postgres.mjs",
    },
    "./artifact/sqlite": {
      types: "./dist/artifact/sqlite.d.mts",
      import: "./dist/artifact/sqlite.mjs",
    },
  })
  expect(buildConfig.entry).toMatchObject({
    artifact: "src/artifact/index.ts",
    "artifact/mysql": "src/artifact/mysql.ts",
    "artifact/postgres": "src/artifact/postgres.ts",
    "artifact/sqlite": "src/artifact/sqlite.ts",
  })
})

test("keeps artifact dialect imports isolated by entrypoint", () => {
  const entrypoints = [
    ["program", []],
    ["mysql", ["mysql"]],
    ["postgres", ["postgres"]],
    ["sqlite", ["sqlite"]],
  ] as const

  for (const [entrypoint, expected] of entrypoints) {
    const source = readFileSync(resolve(packageRoot, "src/artifact", `${entrypoint}.ts`), "utf8")
    const imports = [
      ...source.matchAll(/from\s+["']qubu\/snapshot\/(mysql|postgres|sqlite)["']/g),
    ].map((match) => match[1])

    expect(imports, entrypoint).toEqual(expected)
  }
})
