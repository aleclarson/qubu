import { expectTypeOf } from "vitest"

import { createDialect } from "../src/core/index.ts"
import type { Dialect } from "../src/core/index.ts"
import { postgresDialect } from "../src/dialects/postgres.ts"
import { createSchemaDialect } from "../src/schema/index.ts"
import type { SchemaDialect } from "../src/schema/index.ts"
import { postgresSchemaDialect } from "../src/snapshot/index.ts"

const queryDialect = postgresDialect()
const schemaDialect = createSchemaDialect(queryDialect, { version: 1 })

expectTypeOf(schemaDialect).toMatchTypeOf<
  Dialect<"ilike" | "json" | "on-conflict" | "row-locking">
>()
expectTypeOf(schemaDialect).toMatchTypeOf<
  SchemaDialect<"ilike" | "json" | "on-conflict" | "row-locking">
>()
expectTypeOf(postgresSchemaDialect).toMatchTypeOf<
  SchemaDialect<"ilike" | "json" | "on-conflict" | "row-locking">
>()

const custom = createSchemaDialect(
  createDialect({
    name: "custom",
    placeholder: () => "?",
  }),
  {
    version: 1,
  },
)

expectTypeOf(custom.name).toBeString()
expectTypeOf(custom.schema.version).toBeNumber()
