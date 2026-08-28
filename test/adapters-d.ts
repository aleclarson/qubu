import {
  bunSqlAdapter,
  type BunSqlClient,
} from '../adapters/bun-sql/src/index.ts'
import {
  d1Adapter,
  type D1Database,
} from '../adapters/cloudflare-d1/src/index.ts'
import {
  mysql2Adapter,
  type Mysql2Connection,
} from '../adapters/mysql2/src/index.ts'
import { nodeSqliteAdapter } from '../adapters/node-sqlite/src/index.ts'
import { pgAdapter } from '../adapters/pg/src/index.ts'
import { pgliteAdapter } from '../adapters/pglite/src/index.ts'
import { postgresJsAdapter } from '../adapters/postgresjs/src/index.ts'
import type { PGliteInterface } from '@electric-sql/pglite'
import type { DatabaseSync } from 'node:sqlite'
import type { ClientBase } from 'pg'
import type { Sql } from 'postgres'
import { expectTypeOf } from 'vitest'
import { qubu, type QubuExplainableClient } from '../src/index.ts'

declare const nodeSqlite: DatabaseSync
declare const pg: ClientBase
declare const mysql2: Mysql2Connection
declare const bunSql: BunSqlClient
declare const postgresJs: Sql
declare const d1: D1Database
declare const pglite: PGliteInterface

qubu(nodeSqliteAdapter(nodeSqlite)).transaction(async transaction => {
  expectTypeOf(transaction.explain).toBeFunction()
})
qubu(pgAdapter(pg)).transaction(async transaction => {
  expectTypeOf(transaction.explain).toBeFunction()
})
qubu(mysql2Adapter(mysql2)).transaction(async transaction => {
  expectTypeOf(transaction.explain).toBeFunction()
})
qubu(bunSqlAdapter(bunSql)).transaction(async transaction => {
  expectTypeOf(transaction.explain).toBeFunction()
})
qubu(postgresJsAdapter(postgresJs)).transaction(async transaction => {
  expectTypeOf(transaction.explain).toBeFunction()
})
qubu(pgliteAdapter(pglite)).transaction(async transaction => {
  expectTypeOf(transaction.explain).toBeFunction()
})

expectTypeOf(qubu(d1Adapter(d1))).toEqualTypeOf<
  QubuExplainableClient<ReturnType<typeof d1Adapter>>
>()
// @ts-expect-error D1 does not expose an interactive transaction primitive.
qubu(d1Adapter(d1)).transaction(async () => undefined)
