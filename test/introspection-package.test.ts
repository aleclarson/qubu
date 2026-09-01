import { readFileSync } from "node:fs"

import * as root from "qubu"
import * as core from "qubu/core"
import * as introspection from "qubu/introspection"
import * as mysqlIntrospection from "qubu/introspection/mysql"
import * as postgresIntrospection from "qubu/introspection/postgres"
import * as sqliteIntrospection from "qubu/introspection/sqlite"
import * as schema from "qubu/schema"
import * as snapshot from "qubu/snapshot"
import * as mysqlSnapshot from "qubu/snapshot/mysql"
import * as postgresSnapshot from "qubu/snapshot/postgres"
import * as sqliteSnapshot from "qubu/snapshot/sqlite"
import { expect, test } from "vitest"

import buildConfig from "../tsdown.config.ts"

type PackageManifest = {
  exports: Record<string, string | { types: string }>
  publishConfig: {
    exports: Record<
      string,
      | string
      | {
          types: string
          import?: string
        }
    >
  }
}

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as PackageManifest

test("resolves optional entrypoints without widening existing entrypoints", () => {
  expect(introspection.mapCatalogToSnapshot).toBeTypeOf("function")
  expect(postgresIntrospection.readCatalog).toBeTypeOf("function")
  expect(sqliteIntrospection.readCatalog).toBeTypeOf("function")
  expect(mysqlIntrospection.readCatalog).toBeTypeOf("function")

  expect(root).not.toHaveProperty("readPostgresCatalog")
  expect(introspection).not.toHaveProperty("readPostgresCatalog")
  expect(introspection).not.toHaveProperty("readSqliteCatalog")
  expect(introspection).not.toHaveProperty("readMysqlCatalog")
  expect(root).not.toHaveProperty("mapCatalogToSnapshot")
  expect(root).not.toHaveProperty("createDialect")
  expect(root).not.toHaveProperty("customSource")
  expect(core.createDialect).toBeTypeOf("function")
  expect(core.fragment).toBeTypeOf("function")
  expect(schema.customSource).toBeTypeOf("function")
  expect(snapshot.createSchemaSnapshot).toBeTypeOf("function")
  expect(snapshot.decodeSchemaSnapshot).toBeTypeOf("function")
  expect(snapshot).not.toHaveProperty("createPostgresSchemaSnapshot")
  expect(snapshot).not.toHaveProperty("createSqliteSchemaSnapshot")
  expect(snapshot).not.toHaveProperty("createMysqlSchemaSnapshot")
  expect(postgresSnapshot.createSchemaSnapshot).toBeTypeOf("function")
  expect(sqliteSnapshot.createSchemaSnapshot).toBeTypeOf("function")
  expect(mysqlSnapshot.createSchemaSnapshot).toBeTypeOf("function")
  expect(postgresSnapshot).not.toHaveProperty("createPostgresSchemaSnapshot")
  expect(sqliteSnapshot).not.toHaveProperty("createSqliteSchemaSnapshot")
  expect(mysqlSnapshot).not.toHaveProperty("createMysqlSchemaSnapshot")
})

test("keeps source and publish exports aligned with the build entry", () => {
  expect(manifest.exports).toMatchObject({
    ".": "./src/index.ts",
    "./core": "./src/core/index.ts",
    "./schema": "./src/schema/index.ts",
    "./snapshot": "./src/snapshot/index.ts",
    "./snapshot/mysql": "./src/snapshot/mysql.ts",
    "./snapshot/postgres": "./src/snapshot/postgres.ts",
    "./snapshot/sqlite": "./src/snapshot/sqlite.ts",
    "./introspection": "./src/introspection/index.ts",
    "./introspection/mysql": "./src/introspection/mysql.ts",
    "./introspection/postgres": "./src/introspection/postgres.ts",
    "./introspection/sqlite": "./src/introspection/sqlite.ts",
  })
  expect(manifest.publishConfig.exports).toMatchObject({
    ".": {
      types: "./dist/index.d.mts",
      import: "./dist/index.mjs",
    },
    "./core": {
      types: "./dist/core.d.mts",
      import: "./dist/core.mjs",
    },
    "./schema": {
      types: "./dist/schema.d.mts",
      import: "./dist/schema.mjs",
    },
    "./snapshot": {
      types: "./dist/snapshot.d.mts",
      import: "./dist/snapshot.mjs",
    },
    "./snapshot/mysql": {
      types: "./dist/snapshot/mysql.d.mts",
      import: "./dist/snapshot/mysql.mjs",
    },
    "./snapshot/postgres": {
      types: "./dist/snapshot/postgres.d.mts",
      import: "./dist/snapshot/postgres.mjs",
    },
    "./snapshot/sqlite": {
      types: "./dist/snapshot/sqlite.d.mts",
      import: "./dist/snapshot/sqlite.mjs",
    },
    "./introspection": {
      types: "./dist/introspection.d.mts",
      import: "./dist/introspection.mjs",
    },
    "./introspection/mysql": {
      types: "./dist/introspection/mysql.d.mts",
      import: "./dist/introspection/mysql.mjs",
    },
    "./introspection/postgres": {
      types: "./dist/introspection/postgres.d.mts",
      import: "./dist/introspection/postgres.mjs",
    },
    "./introspection/sqlite": {
      types: "./dist/introspection/sqlite.d.mts",
      import: "./dist/introspection/sqlite.mjs",
    },
  })
  expect(buildConfig.entry).toMatchObject({
    core: "src/core/index.ts",
    schema: "src/schema/index.ts",
    introspection: "src/introspection/index.ts",
    "introspection/mysql": "src/introspection/mysql.ts",
    "introspection/postgres": "src/introspection/postgres.ts",
    "introspection/sqlite": "src/introspection/sqlite.ts",
    snapshot: "src/snapshot/index.ts",
    "snapshot/mysql": "src/snapshot/mysql.ts",
    "snapshot/postgres": "src/snapshot/postgres.ts",
    "snapshot/sqlite": "src/snapshot/sqlite.ts",
  })
})
