import { expectTypeOf } from "vitest"

import { eq, from, fullJoin, integer, leftJoin, rightJoin, select, table } from "../src/index.ts"

const accounts = table("audit_join_accounts", { id: integer() })
const entries = table("audit_join_entries", { accountId: integer() })
const selection = {
  accountId: accounts.id,
  entryAccountId: entries.accountId,
}
const condition = eq(accounts.id, entries.accountId)

const right = select(selection, from(accounts), rightJoin(entries, condition))
const full = select(selection, from(accounts), fullJoin(entries, condition))
const left = select(selection, from(accounts), leftJoin(entries, condition))

// An unmatched right-hand row has no account; FULL JOIN also permits an
// unmatched account with no entry. The LEFT JOIN contract is the control.
expectTypeOf(right.row).toEqualTypeOf<{
  accountId: number | null
  entryAccountId: number
}>()
expectTypeOf(full.row).toEqualTypeOf<{
  accountId: number | null
  entryAccountId: number | null
}>()
expectTypeOf(left.row).toEqualTypeOf<{
  accountId: number
  entryAccountId: number | null
}>()
