import type { Connection, PoolConnection } from "mysql2/promise"
import { expectTypeOf } from "vitest"

import { migrate, type Mysql2MigrationResult } from "../adapters/mysql2/src/migration.ts"

declare const connection: Connection
declare const pooledConnection: PoolConnection

expectTypeOf(
  migrate(connection, [
    {
      id: "first",
      sql: ["SELECT 1"],
    },
  ]),
).toEqualTypeOf<Promise<Mysql2MigrationResult>>()
migrate(pooledConnection, [])
migrate(connection, [
  {
    id: "first",
    // @ts-expect-error Each migration contains an ordered array of statements.
    sql: "SELECT 1",
  },
])
