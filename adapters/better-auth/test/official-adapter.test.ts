import { DatabaseSync } from 'node:sqlite'
import {
  joinsTestSuite,
  normalTestSuite,
  testAdapter,
  transactionsTestSuite,
} from '@better-auth/test-utils/adapter'
import { getMigrations } from 'better-auth/db/migration'
import { nodeSqliteAdapter } from '@qubu/adapter-node-sqlite'
import {
  qubu,
  type ExecutionRequest,
  type TransactionalQueryAdapter,
} from 'qubu'
import { sqliteDialect } from 'qubu/sqlite'
import { qubuAdapter } from '@qubu/better-auth'

let database = new DatabaseSync(':memory:')
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

const { execute } = await testAdapter({
  adapter: () => qubuAdapter(qubu(dynamicAdapter)),
  async runMigrations(options) {
    database.close()
    database = new DatabaseSync(':memory:')
    const migrations = await getMigrations({ ...options, database })
    await migrations.runMigrations()
  },
  tests: [normalTestSuite(), joinsTestSuite(), transactionsTestSuite()],
  onFinish() {
    database.close()
  },
})

execute()
