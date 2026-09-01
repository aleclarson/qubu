import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import * as ddl from "@qubu/migrate/ddl"
import * as mysqlDdl from "@qubu/migrate/ddl/mysql"
import * as postgresDdl from "@qubu/migrate/ddl/postgres"
import * as sqliteDdl from "@qubu/migrate/ddl/sqlite"
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

test("publishes dedicated DDL entrypoints for each dialect", () => {
  expect(ddl.emitMigrationPlan).toBeTypeOf("function")
  expect(postgresDdl.emitMigrationPlan).toBeTypeOf("function")
  expect(sqliteDdl.emitMigrationPlan).toBeTypeOf("function")
  expect(mysqlDdl.emitMigrationPlan).toBeTypeOf("function")
  expect(ddl).not.toHaveProperty("emitPostgresMigrationPlan")
  expect(ddl).not.toHaveProperty("emitSqliteMigrationPlan")
  expect(ddl).not.toHaveProperty("emitMysqlMigrationPlan")

  expect(manifest.exports).toMatchObject({
    "./ddl": "./src/ddl/index.ts",
    "./ddl/mysql": "./src/ddl/mysql.ts",
    "./ddl/postgres": "./src/ddl/postgres.ts",
    "./ddl/sqlite": "./src/ddl/sqlite.ts",
  })
  expect(manifest.publishConfig.exports).toMatchObject({
    "./ddl": {
      types: "./dist/ddl.d.mts",
      import: "./dist/ddl.mjs",
    },
    "./ddl/mysql": {
      types: "./dist/ddl/mysql.d.mts",
      import: "./dist/ddl/mysql.mjs",
    },
    "./ddl/postgres": {
      types: "./dist/ddl/postgres.d.mts",
      import: "./dist/ddl/postgres.mjs",
    },
    "./ddl/sqlite": {
      types: "./dist/ddl/sqlite.d.mts",
      import: "./dist/ddl/sqlite.mjs",
    },
  })
  expect(buildConfig.entry).toMatchObject({
    ddl: "src/ddl/index.ts",
    "ddl/mysql": "src/ddl/mysql.ts",
    "ddl/postgres": "src/ddl/postgres.ts",
    "ddl/sqlite": "src/ddl/sqlite.ts",
  })
})

test("keeps DDL dialect imports isolated by entrypoint", () => {
  const entrypoints = [
    ["index", ["mysql", "postgres", "sqlite"]],
    ["mysql", ["mysql"]],
    ["postgres", ["postgres"]],
    ["sqlite", ["sqlite"]],
  ] as const

  for (const [entrypoint, expected] of entrypoints) {
    const source = readFileSync(resolve(packageRoot, "src/ddl", `${entrypoint}.ts`), "utf8")
    const imports = [
      ...source.matchAll(/from\s+["']qubu\/snapshot\/(mysql|postgres|sqlite)["']/g),
    ].map((match) => match[1])

    expect(imports, entrypoint).toEqual(expected)
  }
})
