import { expectTypeOf } from "vitest"

import { add, caseWhen, coalesce, eq, from, integer, select, table, text } from "../src/index.ts"

const records = table("audit_computations", {
  amount: integer(),
  label: text(),
  optionalLabel: text({ nullable: true }),
})
const computed = select(
  {
    amount: records.amount,
    label: records.label,
    increased: add(records.amount, 1),
    fallback: coalesce(records.optionalLabel, records.label),
    conditional: caseWhen(eq(records.amount, 0), records.label, "other"),
  },
  from(records),
)

// Built-in computations must retain their operand/branch output types rather
// than exposing unknown values to every caller of rows() or execute().
expectTypeOf(computed.row.amount).toEqualTypeOf<number>()
expectTypeOf(computed.row.label).toEqualTypeOf<string>()
expectTypeOf(computed.row.increased).toEqualTypeOf<number>()
expectTypeOf(computed.row.fallback).toEqualTypeOf<string>()
expectTypeOf(computed.row.conditional).toEqualTypeOf<string>()
