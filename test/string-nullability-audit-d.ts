import { expectTypeOf } from "vitest"

import { type ExpressionOutput, from, lower, select, table, text, upper } from "../src/index.ts"

const records = table("audit_nullable_strings", {
  requiredName: text(),
  optionalName: text({ nullable: true }),
})

const required = select(
  {
    lowered: lower(records.requiredName),
    uppered: upper(records.requiredName),
  },
  from(records),
)

expectTypeOf(required.row).toEqualTypeOf<{
  lowered: string
  uppered: string
}>()

const loweredNullable = lower(records.optionalName)
const upperedNullable = upper(records.optionalName)

expectTypeOf<ExpressionOutput<typeof loweredNullable>>().toEqualTypeOf<string | null>()
expectTypeOf<ExpressionOutput<typeof upperedNullable>>().toEqualTypeOf<string | null>()
