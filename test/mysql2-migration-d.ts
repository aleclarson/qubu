import type { Connection, PoolConnection } from "mysql2/promise"
import { expectTypeOf } from "vitest"

import { migrateMysql2, type Mysql2MigrationResult } from "../adapters/mysql2/src/migration.ts"

declare const connection: Connection
declare const pooledConnection: PoolConnection

expectTypeOf(
  migrateMysql2(connection, [
    {
      id: "first",
      sql: ["SELECT 1"],
    },
  ]),
).toEqualTypeOf<Promise<Mysql2MigrationResult>>()
migrateMysql2(pooledConnection, [])
migrateMysql2(connection, [
  {
    id: "first",
    // @ts-expect-error Each migration contains an ordered array of statements.
    sql: "SELECT 1",
  },
])
