import { expectTypeOf } from "vitest"

import { makeExpression } from "../src/core/index.ts"
import { gt, integer, table } from "../src/index.ts"
import type { ResultMeta } from "../src/index.ts"
import type { AnySchemaExpression, SchemaExpression } from "../src/index.ts"
import { schemaExpression } from "../src/schema/index.ts"
import { renderSchemaExpression } from "../src/schema/index.ts"

const records = table("schema_expression_types", { value: integer() })
const builtIn = gt(records.value, 0)
const custom = makeExpression<ResultMeta<boolean>, "function">("function", (context) =>
  context.append("TRUE"),
)
const optedIn = schemaExpression(custom)

expectTypeOf<typeof builtIn>().toMatchTypeOf<AnySchemaExpression>()
expectTypeOf<typeof optedIn>().toMatchTypeOf<SchemaExpression>()
renderSchemaExpression(builtIn, { mode: "check" })
renderSchemaExpression(optedIn, { mode: "check" })

// @ts-expect-error Query extensions must explicitly opt into the schema contract.
renderSchemaExpression(custom, { mode: "check" })
