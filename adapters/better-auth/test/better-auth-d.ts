import { betterAuthSchema, qubuAdapter } from "@qubu/better-auth"
import type { DBAdapter } from "better-auth/adapters"
import type { BetterAuthOptions } from "better-auth/types"
import { qubu, type TransactionalQueryAdapter } from "qubu"
import { postgresDialect } from "qubu/postgres"
import { expectTypeOf } from "vitest"

declare const adapter: TransactionalQueryAdapter
const factory = qubuAdapter(qubu(adapter))
const database: DBAdapter = factory({} satisfies BetterAuthOptions)

expectTypeOf(database.consumeOne).toBeFunction()
expectTypeOf(database.incrementOne).toBeFunction()
expectTypeOf(betterAuthSchema({}, "postgresql").tableFor("user").tableName).toBeString()

// @ts-expect-error Supported dialect names are explicit.
betterAuthSchema({}, "standard")
postgresDialect()
