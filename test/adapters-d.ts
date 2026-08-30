import type { DatabaseSync } from "node:sqlite"

import type { PGliteInterface } from "@electric-sql/pglite"
import type { ClientBase } from "pg"
import type { Sql } from "postgres"
import { expectTypeOf } from "vitest"

import {
  rdsDataApiAdapter as rdsDataApiMysqlAdapter,
  type RdsDataApiClient,
} from "../adapters/aws-rds-data-api/src/mysql.ts"
import { rdsDataApiAdapter as rdsDataApiPostgresAdapter } from "../adapters/aws-rds-data-api/src/postgres.ts"
import { bunSqlAdapter, type BunSqlClient } from "../adapters/bun-sql/src/index.ts"
import { d1Adapter, type D1Database } from "../adapters/cloudflare-d1/src/index.ts"
import { mysql2Adapter, type Mysql2Connection } from "../adapters/mysql2/src/index.ts"
import { neonAdapter, type NeonHttpClient } from "../adapters/neon/src/index.ts"
import { nodeSqliteAdapter } from "../adapters/node-sqlite/src/index.ts"
import { pgAdapter } from "../adapters/pg/src/index.ts"
import { pgliteAdapter } from "../adapters/pglite/src/index.ts"
import { planetscaleAdapter, type PlanetScaleClient } from "../adapters/planetscale/src/index.ts"
import { postgresJsAdapter } from "../adapters/postgresjs/src/index.ts"
import { sqliteWasmAdapter, type SqliteWasmDatabase } from "../adapters/sqlite-wasm/src/index.ts"
import { qubu, type QubuExplainableClient } from "../src/index.ts"

declare const nodeSqlite: DatabaseSync
declare const pg: ClientBase
declare const mysql2: Mysql2Connection
declare const bunSql: BunSqlClient
declare const postgresJs: Sql
declare const d1: D1Database
declare const pglite: PGliteInterface
declare const neon: NeonHttpClient
declare const planetscale: PlanetScaleClient
declare const rdsDataApi: RdsDataApiClient
declare const sqliteWasm: SqliteWasmDatabase

qubu(nodeSqliteAdapter(nodeSqlite)).transaction(async (transaction) => {
  expectTypeOf(transaction.explain).toBeFunction()
})
qubu(pgAdapter(pg)).transaction(async (transaction) => {
  expectTypeOf(transaction.explain).toBeFunction()
})
qubu(mysql2Adapter(mysql2)).transaction(async (transaction) => {
  expectTypeOf(transaction.explain).toBeFunction()
})
qubu(bunSqlAdapter(bunSql)).transaction(async (transaction) => {
  expectTypeOf(transaction.explain).toBeFunction()
})
qubu(postgresJsAdapter(postgresJs)).transaction(async (transaction) => {
  expectTypeOf(transaction.explain).toBeFunction()
})
qubu(pgliteAdapter(pglite)).transaction(async (transaction) => {
  expectTypeOf(transaction.explain).toBeFunction()
})

expectTypeOf(qubu(d1Adapter(d1))).toEqualTypeOf<
  QubuExplainableClient<ReturnType<typeof d1Adapter>>
>()
// @ts-expect-error D1 does not expose an interactive transaction primitive.
qubu(d1Adapter(d1)).transaction(async () => undefined)

expectTypeOf(qubu(neonAdapter(neon))).toEqualTypeOf<
  QubuExplainableClient<ReturnType<typeof neonAdapter>>
>()
// @ts-expect-error Neon HTTP does not expose an interactive transaction primitive.
qubu(neonAdapter(neon)).transaction(async () => undefined)
// @ts-expect-error Neon HTTP does not expose streaming.
qubu(neonAdapter(neon)).stream(async function* () {})

qubu(planetscaleAdapter(planetscale)).transaction(async (transaction) => {
  expectTypeOf(transaction.explain).toBeFunction()
})
// @ts-expect-error PlanetScale does not expose streaming.
qubu(planetscaleAdapter(planetscale)).stream(async function* () {})

const rdsDataApiPostgres = rdsDataApiPostgresAdapter(rdsDataApi, {
  resourceArn: "resource",
  secretArn: "secret",
})

const rdsDataApiMysql = rdsDataApiMysqlAdapter(rdsDataApi, {
  resourceArn: "resource",
  secretArn: "secret",
})

expectTypeOf(rdsDataApiPostgres.engine).toEqualTypeOf<"postgresql">()
expectTypeOf(rdsDataApiMysql.engine).toEqualTypeOf<"mysql">()

qubu(rdsDataApiPostgres).transaction(async (transaction) => {
  expectTypeOf(transaction.explain).toBeFunction()
})
// @ts-expect-error RDS Data API does not expose streaming.
qubu(rdsDataApiPostgres).stream(async function* () {})

expectTypeOf(qubu(sqliteWasmAdapter(sqliteWasm))).toEqualTypeOf<
  QubuExplainableClient<ReturnType<typeof sqliteWasmAdapter>>
>()
// @ts-expect-error SQLite WASM adapter does not expose an interactive transaction primitive.
qubu(sqliteWasmAdapter(sqliteWasm)).transaction(async () => undefined)
