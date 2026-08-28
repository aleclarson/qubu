import { expectTypeOf } from "vitest"

import { integer, schema, table } from "../src/index.ts"
import type { SourceIdentity, TableIdentity } from "../src/index.ts"

const accounts = table("account_records", { id: integer() })
const memberships = table("membership_records", {
  accountId: integer(),
})
const registry = schema({
  accounts,
  memberships,
})

expectTypeOf(registry.tables.accounts).toEqualTypeOf<typeof accounts>()
expectTypeOf(registry.registry.accounts.table).toEqualTypeOf<typeof accounts>()
expectTypeOf(registry.registry.accounts.id).toEqualTypeOf<"accounts">()
expectTypeOf(registry.tableNames.memberships).toBeString()
expectTypeOf<SourceIdentity<typeof accounts>>().toEqualTypeOf<TableIdentity<"account_records">>()

// @ts-expect-error Root schema tables are readonly.
registry.tables.accounts = memberships
// @ts-expect-error Registry entries are readonly.
registry.registry.accounts = registry.registry.memberships
