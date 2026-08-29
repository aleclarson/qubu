import { DatabaseSync } from "node:sqlite"

import {
  joinsTestSuite,
  normalTestSuite,
  testAdapter,
  transactionsTestSuite,
} from "@better-auth/test-utils/adapter"
import { nodeSqliteAdapter } from "@qubu/adapter-node-sqlite"
import { betterAuthSchemaFromTables, qubuAdapter } from "@qubu/better-auth"
import { getAuthTables } from "better-auth/db"
import { getMigrations } from "better-auth/db/migration"
import type { BetterAuthOptions } from "better-auth/types"
import { qubu, type ExecutionRequest, type TransactionalQueryAdapter } from "qubu"
import { sqliteDialect } from "qubu/sqlite"

let database = new DatabaseSync(":memory:")
const dynamicAdapter: TransactionalQueryAdapter = {
  dialect: sqliteDialect(),
  execute(request: ExecutionRequest) {
    return sqliteAdapter().execute(request)
  },
  transaction(callback, options) {
    return sqliteAdapter().transaction(callback, options)
  },
}

function sqliteAdapter() {
  return nodeSqliteAdapter(database)
}

function harnessAdapter(options: BetterAuthOptions) {
  const tables = getAuthTables(options)
  const fieldNames = Object.fromEntries(
    Object.entries(tables).map(([model, metadata]) => [
      model,
      Object.fromEntries(
        Object.entries(metadata.fields).map(([field, attribute]) => [
          field,
          attribute.fieldName ?? field,
        ]),
      ),
    ]),
  )
  const schema = betterAuthSchemaFromTables(tables, "sqlite", { fieldNames })

  return qubuAdapter(qubu(dynamicAdapter), { schema })(options)
}

const { execute } = await testAdapter({
  adapter: () => harnessAdapter,
  async runMigrations(options) {
    database.close()
    database = new DatabaseSync(":memory:")
    const migrations = await getMigrations({
      ...options,
      database,
    })

    await migrations.runMigrations()
  },
  tests: [normalTestSuite(), joinsTestSuite(), transactionsTestSuite()],
  onFinish() {
    database.close()
  },
})

execute()
