import { expectTypeOf } from "vitest"

import { schema, table, text } from "../src/index.ts"
import type { SchemaDialect } from "../src/index.ts"
import { createSchemaSnapshot } from "../src/snapshot/index.ts"
import type { SchemaSnapshot, SchemaSnapshotAdapter } from "../src/snapshot/index.ts"
import { createPostgresSchemaSnapshot, postgresSnapshotAdapter } from "../src/snapshot/postgres.ts"

const records = table("records", { name: text() })
const registry = schema({ records })

expectTypeOf(createPostgresSchemaSnapshot(registry)).toMatchTypeOf<SchemaSnapshot>()
expectTypeOf(
  createSchemaSnapshot(registry, { adapter: postgresSnapshotAdapter }),
).toMatchTypeOf<SchemaSnapshot>()
expectTypeOf(postgresSnapshotAdapter).toMatchTypeOf<SchemaSnapshotAdapter>()
expectTypeOf(postgresSnapshotAdapter.dialect).toMatchTypeOf<
  SchemaDialect<"ilike" | "json" | "on-conflict" | "row-locking">
>()
