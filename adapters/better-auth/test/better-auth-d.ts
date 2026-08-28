import type { BetterAuthOptions } from 'better-auth/types'
import type { DBAdapter } from 'better-auth/adapters'
import { expectTypeOf } from 'vitest'
import { qubu, type TransactionalQueryAdapter } from 'qubu'
import { postgresDialect } from 'qubu/postgres'
import { betterAuthSchema, qubuAdapter } from '@qubu/better-auth'

declare const adapter: TransactionalQueryAdapter
const factory = qubuAdapter(qubu(adapter))
const database: DBAdapter = factory({} satisfies BetterAuthOptions)

expectTypeOf(database.consumeOne).toBeFunction()
expectTypeOf(database.incrementOne).toBeFunction()
expectTypeOf(
  betterAuthSchema({}, 'postgresql').tableFor('user').tableName
).toBeString()

// @ts-expect-error Supported dialect names are explicit.
betterAuthSchema({}, 'standard')
postgresDialect()
